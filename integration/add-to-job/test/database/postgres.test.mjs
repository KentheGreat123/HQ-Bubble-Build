import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {database,seed,workflow,ids,principal,asUser,adminClient} from './support.mjs';
import {createCloudHandler} from '../../src/cloud-handler.mjs';
import {reconcileMaterial} from '../../src/reconciliation.mjs';
let db;before(async()=>{db=await database({onMigration:async(db,file)=>{
 const tables=(await db.query(`select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,
 has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') anon_access,
 has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') client_write,
 has_table_privilege('authenticated',c.oid,'SELECT') client_read
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind='r' and (n.nspname='public' and c.relname like 'hq_%' or n.nspname='hq_private')`)).rows;
 assert.equal(tables.length,16);
 for(const t of tables){
  assert.ok(t.relrowsecurity&&t.relforcerowsecurity,`${file}: ${t.relname} RLS`);
  assert.equal(t.anon_access,false,`${file}: ${t.relname} anonymous access`);
  assert.equal(t.client_write,false,`${file}: ${t.relname} client write`);
  assert.equal(t.client_read,!file.includes('_schema')&&t.nspname==='public',`${file}: ${t.relname} read publication`);
 }
 const secret=(await db.query(`select has_schema_privilege('authenticated','vault','USAGE') usage,
 has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') decrypt,
 has_function_privilege('authenticated','vault.test_secret_mutator()','EXECUTE') mutate`)).rows[0];
 assert.deepEqual(secret,{usage:false,decrypt:false,mutate:false});
 if(file.includes('_transactions')){
  const rpc=(await db.query(`select has_function_privilege('authenticated','public.hq_backend(uuid,uuid,text,jsonb)','EXECUTE') client,
   has_function_privilege('service_role','public.hq_backend(uuid,uuid,text,jsonb)','EXECUTE') server`)).rows[0];
  assert.deepEqual(rpc,{client:false,server:true});
 }
}});});beforeEach(()=>seed(db));after(()=>db?.close());
const scalar=async sql=>(await db.query(sql)).rows[0];

test('migrations enforce RLS on every public and private HQ table',async()=>{
 const {n}=await scalar("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname='public' and c.relname like 'hq_%' or n.nspname='hq_private') and c.relkind='r' and (not c.relrowsecurity or not c.relforcerowsecurity)");assert.equal(n,0);
 const a=await asUser(db,ids.u,'select id from public.hq_accounts');assert.deepEqual(a.rows.map(r=>r.id),[ids.a]);
 const b=await asUser(db,ids.v,'select id from public.hq_accounts');assert.deepEqual(b.rows.map(r=>r.id),[ids.b]);
 assert.equal((await asUser(db,ids.v,'select * from public.hq_catalog_parts')).rows.length,0);
});
test('anonymous users, forged actors, direct client mutations and secrets are denied',async()=>{
 await assert.rejects(asUser(db,ids.u,"update public.hq_memberships set role='admin'"),/permission denied/);
 await assert.rejects(asUser(db,ids.u,'select * from hq_private.material_submissions'),/permission denied/);
 await assert.rejects(asUser(db,ids.admin,'select * from vault.decrypted_secrets'),/permission denied/);
 await assert.rejects(asUser(db,ids.u,`select public.hq_backend('${ids.admin}','${ids.a}','credential','{}')`),/permission denied/);
 await db.exec('begin;set local role anon;');try{await assert.rejects(db.query('select * from public.hq_accounts'),/permission denied/);}finally{await db.exec('rollback');}
 await assert.rejects(workflow(db,{principal:{id:ids.u,accountId:ids.b}}).service.resolveJob({id:ids.u,accountId:ids.b},'4187'),e=>e.code==='FORBIDDEN');
});
test('revocation and database roles override JWT/user metadata',async()=>{
 const viewer=workflow(db,{principal:{id:ids.viewer,accountId:ids.a}});
 await assert.rejects(viewer.command(),e=>e.code==='FORBIDDEN');
 const w=workflow(db),cmd=await w.command();await db.query('update public.hq_memberships set active=false where user_id=$1',[ids.u]);
 await assert.rejects(w.service.addMaterial(principal,cmd),e=>e.code==='FORBIDDEN');assert.equal(w.calls.filter(c=>c.method==='POST').length,0);
});
test('cross-account foreign keys and second active connections are rejected',async()=>{
 await assert.rejects(db.query(`insert into public.hq_inventory_balances values($1,$2,$3,1,0)`,[ids.b,ids.l,ids.p]),/foreign key/);
 await assert.rejects(db.query(`insert into public.hq_platform_connections(account_id,platform,external_account_id,status) values($1,'servicetitan','other','active')`,[ids.a]),/duplicate key/);
 await assert.rejects(db.query('update public.hq_accounts set active_connection_id=$1 where id=$2',[ids.d,ids.a]),/foreign key|ACTIVE_CONNECTION/);
});
test('PostgreSQL workflow reads back the selected material then commits stock and ledger exactly once',async()=>{
 const w=workflow(db),cmd=await w.command();const result=await w.service.addMaterial(principal,cmd);
 assert.equal(result.status,'confirmed');assert.equal(result.material.description,'Part # ACTUAL-SKU');
 await w.service.addMaterial(principal,cmd);await w.service.recoverInventory(principal,{idempotencyKey:cmd.idempotencyKey});
 assert.equal(w.calls.filter(c=>c.method==='POST').length,1);assert.ok(w.calls.some(c=>c.method==='GET'&&c.path==='/jobs/job-a/line_items'));
 assert.deepEqual(await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances'),{on_hand:'8.00',reserved:'0.00'});
 assert.equal((await scalar('select count(*)::int n from public.hq_inventory_ledger')).n,1);
});
test('atomic claim prevents duplicate dispatch and insufficient stock records a durable failed request',async()=>{
 const w=workflow(db),cmd=await w.command('11');await assert.rejects(w.service.addMaterial(principal,cmd),e=>e.code==='INSUFFICIENT_INVENTORY');
 assert.equal((await w.service.submissionStatus(principal,{idempotencyKey:cmd.idempotencyKey})).status,'failed');
 await assert.rejects(w.service.addMaterial(principal,cmd),e=>e.code==='SUBMISSION_FAILED');assert.equal(w.lines.length,0);
 assert.equal((await scalar('select reserved::text from public.hq_inventory_balances')).reserved,'0.00');
});
test('read-back interruption holds stock, survives a new service instance and never reposts',async()=>{
 const w=workflow(db),cmd=await w.command();w.setFailure('read');const result=await w.service.addMaterial(principal,cmd);
 assert.equal(result.status,'verification_pending');assert.equal((await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances')).reserved,'2.00');
 assert.equal((await w.service.addMaterial(principal,cmd)).status,'verification_pending');
 w.setFailure('normal');assert.equal((await w.service.recoverInventory(principal,{idempotencyKey:cmd.idempotencyKey})).status,'confirmed');
 const restarted=workflow(db,{transport:w.transport});
 assert.equal((await restarted.service.addMaterial(principal,cmd)).status,'confirmed');
 assert.equal(w.calls.filter(c=>c.method==='POST').length,1);
});
test('lost POST response remains unknown and inventory cannot be committed or released automatically',async()=>{
 const w=workflow(db),cmd=await w.command();w.setFailure('lost');await assert.rejects(w.service.addMaterial(principal,cmd),e=>e.code==='SUBMISSION_UNKNOWN');
 await assert.rejects(w.service.addMaterial(principal,cmd),e=>e.code==='SUBMISSION_UNKNOWN');assert.equal(w.lines.length,1);
 await assert.rejects(w.service.recoverInventory(principal,{idempotencyKey:cmd.idempotencyKey}),e=>e.code==='MANUAL_RECONCILIATION_REQUIRED');
 assert.equal((await scalar('select on_hand::text from public.hq_inventory_balances')).on_hand,'10.00');
});
test('ledger failure rolls back stock, reservation and confirmation as one transaction',async()=>{
 await db.exec(`create function public.test_fail_ledger() returns trigger language plpgsql as $$begin raise exception 'INJECTED_TEST_FAILURE';end$$;
 create trigger test_fail before insert on public.hq_inventory_ledger for each row execute function public.test_fail_ledger();`);
 const w=workflow(db),cmd=await w.command();try{
  const result=await w.service.addMaterial(principal,cmd);assert.equal(result.status,'inventory_pending');
  assert.deepEqual(await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances'),{on_hand:'10.00',reserved:'2.00'});
  assert.equal((await scalar('select state from hq_private.material_submissions')).state,'inventory_pending');
 }finally{await db.exec('drop trigger test_fail on public.hq_inventory_ledger;drop function public.test_fail_ledger();');}
 assert.equal((await w.service.recoverInventory(principal,{idempotencyKey:cmd.idempotencyKey})).status,'confirmed');assert.equal(w.lines.length,1);
});
test('claims and quoted prices are rechecked in SQL; uncertain submissions block connection rotation',async()=>{
 const w=workflow(db),cmd=await w.command();await db.exec('update public.hq_catalog_parts set unit_price_cents=1');
 await assert.rejects(w.service.addMaterial(principal,cmd),e=>e.code==='PRICE_OR_SELECTION_CHANGED');
 await db.exec('update public.hq_catalog_parts set unit_price_cents=4610');w.setFailure('lost');await assert.rejects(w.service.addMaterial(principal,cmd));
 await assert.rejects(db.exec('update public.hq_platform_connections set version=version+1'),/CONNECTION_HAS_UNRESOLVED/);
});
test('audit and ledger are append-only and foreign account audits remain invisible',async()=>{
 const w=workflow(db);await w.service.addMaterial(principal,await w.command());
 await assert.rejects(db.exec("update public.hq_audit_records set action='changed'"),/APPEND_ONLY/);
 await assert.rejects(db.exec('delete from public.hq_inventory_ledger'),/APPEND_ONLY/);
 assert.equal((await asUser(db,ids.u,'select * from public.hq_audit_records')).rows.length,0);
 assert.equal((await asUser(db,ids.v,'select * from public.hq_inventory_ledger')).rows.length,0);
});
test('cloud API requires Auth-verified user, account membership and exact CORS origin',async()=>{
 let verified=0;const auth={async getUser(token){verified++;return token==='valid'?{data:{user:{id:ids.u,user_metadata:{role:'owner'}}},error:null}:{data:null,error:{message:'invalid'}};}};
 const handler=createCloudHandler({auth,admin:adminClient(db),allowedOrigins:['https://hq.example']});
 const req=(token='valid',account=ids.a,origin='https://hq.example')=>new Request('https://edge.example/functions/v1/job-materials/api/hq/jobs/resolve',{method:'POST',headers:{authorization:'Bearer '+token,'x-hq-account':account,origin,'content-type':'application/json'},body:JSON.stringify({jobNumber:'4187'})});
 assert.equal((await handler(req('invalid'))).status,401);assert.equal((await handler(req('valid',ids.b))).status,403);
 assert.equal((await handler(req('valid',ids.a,'https://evil.example'))).status,403);
 const response=await handler(req());assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'LIVE_REQUESTS_DISABLED'});assert.equal(verified,3);
});

test('different request keys compete for stock without overselling; same-key concurrent requests dispatch once',async()=>{
 const w=workflow(db),first=await w.command('6','stock-request-0001'),second=await w.command('6','stock-request-0002');
 const results=await Promise.allSettled([w.service.addMaterial(principal,first),w.service.addMaterial(principal,second)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(w.lines.length,1);
 assert.equal((await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances')).on_hand,'4.00');
 // Embedded PostgreSQL serializes queries; native multi-connection contention is
 // covered by the optional native suite rather than claimed by this test.
 const cmd=await w.command('1','duplicate-request-0001');await Promise.allSettled([w.service.addMaterial(principal,cmd),w.service.addMaterial(principal,cmd)]);
 assert.equal(w.lines.length,1);assert.equal(w.calls.filter(c=>c.method==='PUT').length,1);
 assert.equal(w.lines[0].quantity,7);assert.equal((await scalar('select count(*)::int n from public.hq_inventory_ledger')).n,2);
});
test('another technician cannot replay an account-wide key or read its submission',async()=>{
 const w=workflow(db),cmd=await w.command();await w.service.addMaterial(principal,cmd);
 await db.query('insert into public.hq_memberships values($1,$2,$3,true)',[ids.a,ids.v,'technician']);
 const other=workflow(db,{principal:{id:ids.v,accountId:ids.a}});
 await assert.rejects(other.service.addMaterial(other.p,cmd),e=>e.code==='FORBIDDEN');
 await assert.rejects(other.service.submissionStatus(other.p,{idempotencyKey:cmd.idempotencyKey}),e=>e.code==='FORBIDDEN');
});
test('changed HCP read-back fields and duplicate IDs never confirm or decrement inventory',async()=>{
 const w=workflow(db),cmd=await w.command();w.setFailure('read');await w.service.addMaterial(principal,cmd);w.setFailure('normal');
 const line={...w.lines[0]};for(const [field,value]of Object.entries({name:'Other part',description:'Other SKU',kind:'labor',quantity:3,unit_price:1,unit_cost:1,taxable:false})){
  w.lines[0]={...line,[field]:value};assert.equal((await w.service.recoverInventory(principal,{idempotencyKey:cmd.idempotencyKey})).status,'verification_pending');
 }
 w.lines[0]=line;w.lines.push({...line});assert.equal((await w.service.recoverInventory(principal,{idempotencyKey:cmd.idempotencyKey})).status,'verification_pending');
 w.lines.pop();assert.equal((await w.service.recoverInventory(principal,{idempotencyKey:cmd.idempotencyKey})).status,'confirmed');
 assert.equal(w.calls.filter(c=>c.method==='POST').length,1);
});
test('SQL verification refuses missing fields rather than treating NULL comparisons as valid',async()=>{
 const w=workflow(db),cmd=await w.command();w.setFailure('read');const result=await w.service.addMaterial(principal,cmd);
 await assert.rejects(w.rpc('verified',{key:cmd.idempotencyKey,result:{jobId:'job-a',material:{id:result.material.id}}}),e=>e.code==='MATERIAL_VERIFICATION_FAILED');
 await assert.rejects(w.rpc('verified',{key:cmd.idempotencyKey,result:{...result,jobId:'foreign-job'}}),e=>e.code==='MATERIAL_VERIFICATION_FAILED');
});
test('administrator reconciliation reads and verifies a known remote material without another POST',async()=>{
 const w=workflow(db),cmd=await w.command();w.setFailure('lost');await assert.rejects(w.service.addMaterial(principal,cmd));w.setFailure('normal');
 const input={idempotencyKey:cmd.idempotencyKey,action:'verify_existing',materialId:'line-1',evidence:'Operator verified the captured request and matching HCP material ID.'};
 await assert.rejects(reconcileMaterial(w,input),e=>e.code==='FORBIDDEN');
 const administrator=workflow(db,{principal:{id:ids.admin,accountId:ids.a},transport:w.transport});
 assert.equal((await reconcileMaterial(administrator,input)).status,'confirmed');
 assert.equal((await reconcileMaterial(administrator,input)).status,'confirmed');
 assert.equal(w.calls.filter(c=>c.method==='POST').length,1);assert.equal((await scalar('select count(*)::int n from public.hq_inventory_ledger')).n,1);
 assert.equal((await scalar("select count(*)::int n from public.hq_audit_records where action='reconcile_attach' and details ? 'evidence'")).n,1);
});
test('admin reconciliation cannot release a dispatched unknown result or adopt an incorrect line',async()=>{
 const w=workflow(db),cmd=await w.command();w.setFailure('lost');await assert.rejects(w.service.addMaterial(principal,cmd));w.setFailure('normal');
 const administrator=workflow(db,{principal:{id:ids.admin,accountId:ids.a},transport:w.transport});
 const input={idempotencyKey:cmd.idempotencyKey,evidence:'Operator evidence for this exact transaction.'};
 await assert.rejects(reconcileMaterial(administrator,{...input,action:'release_undispatched'}),e=>e.code==='MANUAL_RECONCILIATION_REQUIRED');
 await assert.rejects(reconcileMaterial(administrator,{...input,action:'verify_existing',materialId:'not-the-line'}),e=>e.code==='MATERIAL_VERIFICATION_FAILED');
 assert.equal((await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances')).reserved,'2.00');
});
test('provably undispatched claims can be released with administrator evidence and no stock decrement',async()=>{
 const w=workflow(db),cmd=await w.command();
 const context=await w.service.context(principal,'materials:create'),payload=w.service.material(await w.rpc('part',{sku:cmd.sku}),2);
 await w.store.claim(context.scope,cmd.idempotencyKey,'a'.repeat(64),'job-a',payload,{accountId:ids.a,ownerId:ids.u,connectionId:ids.c,connectionVersion:1,confirmationId:cmd.confirmationId,quoteId:cmd.quoteId});
 const administrator=workflow(db,{principal:{id:ids.admin,accountId:ids.a}});
 assert.equal((await reconcileMaterial(administrator,{idempotencyKey:cmd.idempotencyKey,action:'release_undispatched',evidence:'Process stopped before any dispatch intent was recorded.'})).status,'failed');
 assert.deepEqual(await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances'),{on_hand:'10.00',reserved:'0.00'});
 await assert.rejects(w.store.dispatching(context.scope,cmd.idempotencyKey),e=>e.code==='SUBMISSION_UNKNOWN');
});
test('Vault credential RPC is tenant-bound, role-restricted and does not rely on frontend keys',async()=>{
 const w=workflow(db);assert.equal(await w.rpc('credential',{connectionId:ids.c,version:1}),'fake-test-key-only');
 await assert.rejects(w.rpc('credential',{connectionId:ids.d,version:1}),e=>e.code==='CONNECTION_CHANGED');
 await assert.rejects(workflow(db,{principal:{id:ids.v,accountId:ids.a}}).rpc('credential',{connectionId:ids.c,version:1}),e=>e.code==='FORBIDDEN');
 assert.equal((await asUser(db,ids.admin,'select * from public.hq_platform_connections')).rows.some(r=>'vault_secret_id' in r),false);
});
test('cloud API complete flow strips internal cost and honors roles, quotes, keys and error states',async()=>{
 const w=workflow(db);const auth={getUser:async()=>({data:{user:{id:ids.u}},error:null})};
 const handler=createCloudHandler({auth,admin:w.admin,allowedOrigins:['https://hq.example'],transportFactory:()=>w.transport});
 async function post(path,body){const r=await handler(new Request('https://edge.example/job-materials/api/hq/'+path,{method:'POST',headers:{authorization:'Bearer verified-test-token','x-hq-account':ids.a,origin:'https://hq.example','content-type':'application/json'},body:JSON.stringify(body)}));return{status:r.status,body:await r.json()};}
 const c=await post('jobs/resolve',{jobNumber:'4187'}),selection={confirmationId:c.body.confirmationId,sku:'ACTUAL-SKU',quantity:'2'};
 const q=await post('materials/prepare',selection);const command={...selection,quoteId:q.body.quoteId,idempotencyKey:'cloud-test-0001'};
 const r=await post('materials',command);assert.equal(r.status,201);assert.equal(r.body.status,'confirmed');assert.equal('unitCostCents' in r.body.material,false);
 assert.equal((await post('materials',command)).body.material.id,r.body.material.id);assert.equal(w.lines.length,1);
 assert.equal((await post('materials/status',{idempotencyKey:command.idempotencyKey})).body.status,'confirmed');
 assert.equal((await post('materials',{...command,unitPriceCents:1})).status,400);
});

test('connection configuration rejects an unverified company and a foreign-account Vault secret',async()=>{
 const administrator=workflow(db,{principal:{id:ids.admin,accountId:ids.a}});
 const args={connectionId:ids.c,activate:true,vaultSecretId:ids.secret};
 await assert.rejects(administrator.rpc('configure_connection',args),e=>e.code==='COMPANY_NOT_VERIFIED');
 await db.query('update hq_private.credential_secrets set account_id=$1 where vault_secret_id=$2',[ids.b,ids.secret]).then(
  ()=>assert.fail('cross-account credential ownership unexpectedly changed'),
  e=>assert.match(e.message,/foreign key/));
 const foreign='00000000-0000-4000-8000-000000000052';
 await db.query('insert into vault.secrets values($1,$2)',[foreign,'fake-foreign-key-only']);
 await db.query('insert into hq_private.credential_secrets values($1,$2)',[foreign,ids.b]);
 await assert.rejects(administrator.rpc('configure_connection',{...args,companyVerified:true,vaultSecretId:foreign}));
 assert.equal((await administrator.rpc('connection')).version,1);
});

test('authorization revocation after remote dispatch does not strand a verified inventory transaction',async()=>{
 const w=workflow(db),cmd=await w.command();
 const transport=async req=>{const response=await w.transport(req);if(req.method==='POST')await db.query('update public.hq_memberships set active=false where user_id=$1',[ids.u]);return response;};
 const service=workflow(db,{transport}).service;
 assert.equal((await service.addMaterial(principal,cmd)).status,'confirmed');
 assert.equal((await scalar('select on_hand::text from public.hq_inventory_balances')).on_hand,'8.00');
 await assert.rejects(service.submissionStatus(principal,{idempotencyKey:cmd.idempotencyKey}),e=>e.code==='FORBIDDEN');
});

test('expired quotes and invalid quantities cannot dispatch or reserve stock',async()=>{
 const w=workflow(db),cmd=await w.command();
 await db.exec("update hq_private.material_quotes set expires_at=now()-interval '1 second'");
 await assert.rejects(w.service.addMaterial(principal,cmd));
 for(const quantity of ['0','-1','1.001','NaN'])await assert.rejects(w.command(quantity,'invalid-quantity-0001'));
 assert.equal(w.lines.length,0);
 assert.deepEqual(await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances'),{on_hand:'10.00',reserved:'0.00'});
});

test('a process crash while dispatching can be reconciled by read-back without repeating POST',async()=>{
 const w=workflow(db),cmd=await w.command();w.setFailure('lost');await assert.rejects(w.service.addMaterial(principal,cmd));
 // Simulate process death before the catch handler persisted unknown.
 await db.exec("update hq_private.material_submissions set state='dispatching'");w.setFailure('normal');
 const administrator=workflow(db,{principal:{id:ids.admin,accountId:ids.a},transport:w.transport});
 const result=await reconcileMaterial(administrator,{idempotencyKey:cmd.idempotencyKey,action:'verify_existing',materialId:'line-1',evidence:'Recorded HCP material verified after worker process interruption.'});
 assert.equal(result.status,'confirmed');assert.equal(w.calls.filter(c=>c.method==='POST').length,1);
 assert.equal((await scalar('select on_hand::text from public.hq_inventory_balances')).on_hand,'8.00');
});

async function existingWorkflow(){const w=workflow(db);await w.service.addMaterial(principal,await w.command('2','existing-create-0001'));return w;}
test('absent material creates normally; durable SKU mapping detects an existing material without description matching',async()=>{
 const w=await existingWorkflow();w.lines[0].description='HCP technician edited this text';
 const c=await w.service.resolveJob(principal,'4187'),q=await w.service.prepareMaterial(principal,{confirmationId:c.confirmationId,sku:'ACTUAL-SKU',quantity:'1'});
 assert.equal(q.operation,'update');assert.equal(q.existingQuantity,2);assert.equal(q.newQuantity,3);assert.equal(q.existingMaterialId,'line-1');
 assert.equal(w.calls.filter(c=>c.method==='POST').length,1);
});
test('description-only possible matches are blocked and unrelated material names do not authorize updates',async()=>{
 const w=workflow(db);w.lines.push({id:'unmapped',name:'Selected pump',description:'Part # ACTUAL-SKU',kind:'materials',quantity:2,unit_price:4610,unit_cost:2300,taxable:true});
 await assert.rejects(w.command('1'),e=>e.code==='PART_IDENTITY_UNVERIFIED');
 w.lines[0].description='Unrelated material';
 await assert.rejects(w.command('1'),e=>e.code==='PART_IDENTITY_UNVERIFIED');
 await db.exec(`update hq_private.part_costs set platform_reference='{"id":"selected-ref","type":"pricebook_material"}'`);
 Object.assign(w.lines[0],{service_item_id:'other-ref',service_item_type:'pricebook_material'});
 const cmd=await w.command('1');await w.service.addMaterial(principal,cmd);
 assert.equal(w.lines.length,2);assert.equal(w.calls.filter(c=>c.method==='PUT').length,0);
});
test('multiple reliable pricebook matches block automatic updating',async()=>{
 await db.exec(`update hq_private.part_costs set platform_reference='{"id":"pricebook-a","type":"pricebook_material"}'`);
 const w=await existingWorkflow();w.lines.push({...w.lines[0],id:'line-other'});
 await assert.rejects(w.command('1','multiple-match-0001'),e=>e.code==='MULTIPLE_MATERIAL_MATCHES');assert.equal(w.calls.filter(c=>c.method==='PUT').length,0);
});
test('cancelling a review or omitting explicit quantity confirmation does not mutate HCP or inventory',async()=>{
 const w=await existingWorkflow(),cmd=await w.command('1','cancel-review-0001');
 const {confirmQuantityUpdate,...unconfirmed}=cmd;
 await assert.rejects(w.service.addMaterial(principal,unconfirmed),e=>e.code==='QUANTITY_UPDATE_CONFIRMATION_REQUIRED');
 assert.equal(w.lines[0].quantity,2);assert.equal(w.calls.filter(c=>c.method==='PUT').length,0);
 assert.deepEqual(await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances'),{on_hand:'8.00',reserved:'0.00'});
});
test('changed existing quantity requires fresh confirmation before any quantity update',async()=>{
 const w=await existingWorkflow(),cmd=await w.command('1','stale-update-0001');w.lines[0].quantity=5;
 await assert.rejects(w.service.addMaterial(principal,cmd),e=>e.code==='EXISTING_MATERIAL_CHANGED');
 assert.equal(w.calls.filter(c=>c.method==='PUT').length,0);assert.equal(w.lines[0].quantity,5);
 const fresh=await w.command('1','fresh-update-0001');const r=await w.service.addMaterial(principal,fresh);assert.equal(r.material.quantity,6);
});
test('confirmed update preserves line ID/pricing/properties, debits only the additional quantity and deduplicates taps',async()=>{
 const w=await existingWorkflow();Object.assign(w.lines[0],{unit_of_measure:'each',order_index:4,custom_preserved:'value'});
 await db.exec('update public.hq_catalog_parts set unit_price_cents=1000');
 const cmd=await w.command('1','successful-update-0001');await Promise.allSettled([w.service.addMaterial(principal,cmd),w.service.addMaterial(principal,cmd)]);
 const r=await w.service.addMaterial(principal,cmd);assert.equal(r.status,'confirmed');assert.equal(r.material.id,'line-1');assert.equal(r.material.quantity,3);
 assert.equal(w.lines.length,1);assert.equal(w.lines[0].unit_price,4610);assert.equal(w.lines[0].unit_cost,2300);assert.equal(w.lines[0].taxable,true);assert.equal(w.lines[0].custom_preserved,'value');
 assert.equal(w.calls.filter(c=>c.method==='PUT').length,1);assert.equal(w.calls.filter(c=>c.method==='POST').length,1);
 assert.deepEqual(await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances'),{on_hand:'7.00',reserved:'0.00'});
 assert.equal((await scalar("select quantity_delta::text from public.hq_inventory_ledger where quantity_delta=-1")).quantity_delta,'-1.00');
});
test('update timeout cannot increase quantity twice and administrator read-back reconciles the additional hold',async()=>{
 const w=await existingWorkflow(),cmd=await w.command('1','timeout-update-0001');w.setFailure('lost');
 await assert.rejects(w.service.addMaterial(principal,cmd),e=>e.code==='SUBMISSION_UNKNOWN');
 await assert.rejects(w.service.addMaterial(principal,cmd),e=>e.code==='SUBMISSION_UNKNOWN');assert.equal(w.lines[0].quantity,3);
 assert.deepEqual(await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances'),{on_hand:'8.00',reserved:'1.00'});
 w.setFailure('normal');const admin=workflow(db,{principal:{id:ids.admin,accountId:ids.a},transport:w.transport});
 assert.equal((await reconcileMaterial(admin,{idempotencyKey:cmd.idempotencyKey,action:'verify_existing',materialId:'line-1',evidence:'Operator verified exact prior quantity and confirmed update result.'})).status,'confirmed');
 assert.equal(w.calls.filter(c=>c.method==='PUT').length,1);assert.equal((await scalar('select on_hand::text from public.hq_inventory_balances')).on_hand,'7.00');
});
test('wrong read-back quantity or changed retained properties hold inventory and recover without another PUT',async()=>{
 const w=await existingWorkflow();w.lines[0].unit_of_measure='each';const cmd=await w.command('1','verify-update-0001');
 const transport=async req=>{const r=await w.transport(req);if(req.method==='PUT')w.lines[0].unit_of_measure='box';return r;};
 const service=workflow(db,{transport}).service;
 assert.equal((await service.addMaterial(principal,cmd)).status,'verification_pending');
 w.lines[0].unit_of_measure='each';w.lines[0].quantity=4;
 assert.equal((await service.recoverInventory(principal,{idempotencyKey:cmd.idempotencyKey})).status,'verification_pending');
 w.lines[0].quantity=3;assert.equal((await service.recoverInventory(principal,{idempotencyKey:cmd.idempotencyKey})).status,'confirmed');
 assert.equal(w.calls.filter(c=>c.method==='PUT').length,1);
});
test('failed line-item lookup fails closed and never creates a new line',async()=>{
 const w=workflow(db,{transport:async req=>req.path.endsWith('/line_items')?{status:503,body:null}:{status:200,body:req.path.startsWith('/jobs?')?{page:1,total_pages:1,jobs:[{id:'job-a',invoice_number:'4187',company_id:'company-a'}]}:{id:'job-a',invoice_number:'4187',company_id:'company-a'}}});
 await assert.rejects(w.command('1'),e=>e.code==='HCP_READ_FAILED');
 assert.equal((await scalar('select count(*)::int n from hq_private.material_submissions')).n,0);
});
test('definitive unsupported/unauthorized update never falls back to POST and releases only its additional hold',async()=>{
 const w=await existingWorkflow(),cmd=await w.command('1','unauthorized-update-0001');
 const transport=req=>req.method==='PUT'?{status:403,body:null}:w.transport(req);
 await assert.rejects(workflow(db,{transport}).service.addMaterial(principal,cmd),e=>e.code==='MATERIAL_UPDATE_NOT_AUTHORIZED');
 assert.equal(w.lines.length,1);assert.equal(w.lines[0].quantity,2);assert.equal(w.calls.filter(c=>c.method==='POST').length,1);
 assert.deepEqual(await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances'),{on_hand:'8.00',reserved:'0.00'});
 assert.equal((await scalar("select state from hq_private.material_submissions where request_key='unauthorized-update-0001'")).state,'failed');
});
test('last-moment quantity change after dispatch claim cancels safely and requires fresh confirmation',async()=>{
 const w=await existingWorkflow(),cmd=await w.command('1','late-change-0001');let reads=0;
 const transport=async req=>{if(req.method==='GET'&&req.path.endsWith('/line_items')&&++reads===3)w.lines[0].quantity=5;return w.transport(req);};
 await assert.rejects(workflow(db,{transport}).service.addMaterial(principal,cmd),e=>e.code==='EXISTING_MATERIAL_CHANGED');
 assert.equal(w.calls.filter(c=>c.method==='PUT').length,0);assert.equal(w.lines[0].quantity,5);
 assert.deepEqual(await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances'),{on_hand:'8.00',reserved:'0.00'});
 assert.equal((await scalar("select state from hq_private.material_submissions where request_key='late-change-0001'")).state,'failed');
});
