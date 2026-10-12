// Explicitly opt-in: real local Auth, Vault, PostgREST and gateway, mock-only HCP.
import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Client} from 'pg';
import {createHmac,randomBytes} from 'node:crypto';
import {seed,workflow,ids,principal} from './support.mjs';
import {createCloudHandler} from '../../src/cloud-handler.mjs';

assert.equal(process.env.HQ_SUPABASE_LOCAL_TEST,'1','Explicit local test opt-in required');
const config=JSON.parse(readFileSync(new URL('../../../../.tooling/phase1-supabase-local/status.json',import.meta.url)));
const base=config.API_URL,anon=config.ANON_KEY,server=config.SERVICE_ROLE_KEY;
assert.equal(new URL(base).hostname,'127.0.0.1');
assert.equal(new URL(base).port,'54321');
const dbUrl=new URL(config.DB_URL);assert.equal(dbUrl.hostname,'127.0.0.1');assert.equal(dbUrl.port,'54322');
const localFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{
 assert.equal(new URL(typeof input==='string'?input:input.url).hostname,'127.0.0.1','Test HTTP traffic must stay on loopback');
 return localFetch(input,options);
};
let client,db;const sessions={};
async function request(path,{token=server,key=server,method='GET',body,headers={}}={}){
 const r=await fetch(base+path,{method,headers:{apikey:key,authorization:'Bearer '+token,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return{status:r.status,data,headers:r.headers};
}
const admin={rpc:async(name,args)=>{const r=await request('/rest/v1/rpc/'+name,{method:'POST',body:args});return r.status<300?{data:r.data,error:null}:{data:null,error:r.data};}};
const auth={getUser:async token=>{const r=await request('/auth/v1/user',{key:anon,token});return r.status===200?{data:{user:r.data},error:null}:{data:null,error:r.data};}};
function remote(options={}){const w=workflow(db,options);w.admin=admin;return w;}
function handler(w){return createCloudHandler({auth,admin,allowedOrigins:['http://localhost:3000'],transportFactory:()=>w.transport});}
async function post(h,path,body,who='u',account=ids.a){const r=await h(new Request(base+'/functions/v1/job-materials/api/hq/'+path,{method:'POST',headers:{authorization:'Bearer '+sessions[who].access_token,'x-hq-account':account,origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify(body)}));return{status:r.status,data:await r.json()};}
async function command(h,quantity='2',key='local-request-0001'){
 const c=await post(h,'jobs/resolve',{jobNumber:'4187'});assert.equal(c.status,200);
 const selection={confirmationId:c.data.confirmationId,sku:'ACTUAL-SKU',quantity};
 const q=await post(h,'materials/prepare',selection);assert.equal(q.status,200);
 return{...selection,quoteId:q.data.quoteId,idempotencyKey:key,...(q.data.operation==='update'?{confirmQuantityUpdate:true}:{})};
}
const scalar=async sql=>(await db.query(sql)).rows[0];
async function reset(){
 // Reuse exactly the regression fixture, replacing only Auth/Vault substitutes.
 await seed({exec:sql=>db.exec(sql
  .replace('truncate public.hq_accounts,public.hq_users,auth.users,vault.secrets cascade;','truncate public.hq_accounts,public.hq_users cascade;')
  .replace(/insert into auth\.users[^;]+;/,'').replace(/insert into vault\.secrets[^;]+;/,''))});
}
before(async()=>{
 client=new Client({connectionString:config.DB_URL});await client.connect();db={query:(...a)=>client.query(...a),exec:s=>client.query(s)};
 assert.deepEqual((await db.query('select version from supabase_migrations.schema_migrations order by version')).rows.map(r=>r.version),['202610110001','202610110002','202610110003']);
 assert.equal((await db.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname='hq_private' or (n.nspname='public' and c.relname like 'hq_%')) and c.relrowsecurity and c.relforcerowsecurity")).rows[0].n,16);
 for(const who of ['u','v','admin','viewer']){
  const email=`phase1-${who}@example.com`,password=randomBytes(24).toString('hex');
  const list=await request('/auth/v1/admin/users');assert.equal(list.status,200);
  const existing=list.data.users.find(u=>u.email===email);
  const user=existing?await request('/auth/v1/admin/users/'+existing.id,{method:'PUT',body:{password,email_confirm:true}}):await request('/auth/v1/admin/users',{method:'POST',body:{email,password,email_confirm:true,user_metadata:{role:'owner'}}});
  assert.ok([200,201].includes(user.status),JSON.stringify(user.data));ids[who]=user.data.id;
  const login=await request('/auth/v1/token?grant_type=password',{key:anon,token:anon,method:'POST',body:{email,password}});assert.equal(login.status,200,login.status===200?'':JSON.stringify(login.data));sessions[who]=login.data;
 }
 principal.id=ids.u;
 let secret=await db.query("select id from vault.secrets where name='phase1-auth-fixture'");
 if(!secret.rows.length)secret=await db.query("select vault.create_secret('fake-test-key-only','phase1-auth-fixture') id");ids.secret=secret.rows[0].id;
});
beforeEach(reset);
after(async()=>{await client?.end();globalThis.fetch=localFetch;});

test('real password sessions, refresh, invalid credentials and disabled signup',async()=>{
 assert.equal((await auth.getUser(sessions.u.access_token)).data.user.id,ids.u);
 const refresh=await request('/auth/v1/token?grant_type=refresh_token',{key:anon,token:anon,method:'POST',body:{refresh_token:sessions.u.refresh_token}});assert.equal(refresh.status,200);sessions.u=refresh.data;
 assert.equal((await request('/auth/v1/token?grant_type=password',{key:anon,token:anon,method:'POST',body:{email:'phase1-u@example.com',password:'wrong-password'}})).status,400);
 assert.equal((await request('/auth/v1/signup',{key:anon,token:anon,method:'POST',body:{email:'signup@example.invalid',password:'fake-password-123'}})).status,422);
});

test('actual Data API RLS, secret schemas, writes and server-only RPC',async()=>{
 for(const [who,account] of [['u',ids.a],['v',ids.b]]){
  const r=await request('/rest/v1/hq_accounts?select=id',{key:anon,token:sessions[who].access_token});assert.equal(r.status,200);assert.deepEqual(r.data.map(a=>a.id),[account]);
 }
 assert.deepEqual((await request('/rest/v1/hq_catalog_parts?select=*',{key:anon,token:sessions.v.access_token})).data,[]);
 assert.deepEqual((await request('/rest/v1/hq_inventory_balances?select=account_id,on_hand',{key:anon,token:sessions.v.access_token})).data,[]);
 assert.deepEqual((await request('/rest/v1/hq_inventory_balances?select=account_id,on_hand',{key:anon,token:sessions.u.access_token})).data,[{account_id:ids.a,on_hand:10}]);
 assert.equal((await request('/rest/v1/hq_accounts?select=*',{key:anon,token:anon})).status,401);
 const mutation=await request('/rest/v1/hq_memberships?user_id=eq.'+ids.u,{key:anon,token:sessions.u.access_token,method:'PATCH',body:{role:'owner'}});
 assert.equal(mutation.status,403,JSON.stringify(mutation.data));
 for(const schema of ['hq_private','vault'])assert.equal((await request('/rest/v1/material_submissions',{key:anon,token:sessions.u.access_token,headers:{'Accept-Profile':schema}})).status,406);
 const args={p_actor:ids.admin,p_account:ids.a,p_op:'credential',p_args:{connectionId:ids.c,version:1}};
 assert.equal((await request('/rest/v1/rpc/hq_backend',{key:anon,token:sessions.u.access_token,method:'POST',body:args})).status,403);
 assert.equal((await request('/rest/v1/rpc/hq_backend',{key:anon,token:anon,method:'POST',body:args})).status,401);
 assert.equal((await admin.rpc('hq_backend',{...args,p_actor:ids.u})).data,'fake-test-key-only');
});

test('native Vault encryption and SQL grants deny both client roles',async()=>{
 const r=await db.query('select s.secret,d.decrypted_secret from vault.secrets s join vault.decrypted_secrets d using(id) where s.id=$1',[ids.secret]);
 assert.notEqual(r.rows[0].secret,'fake-test-key-only');assert.equal(r.rows[0].decrypted_secret,'fake-test-key-only');
 for(const role of ['anon','authenticated']){
  assert.equal((await db.query("select has_table_privilege($1,'vault.decrypted_secrets','SELECT') access",[role])).rows[0].access,false);
  await db.exec('begin;set local role '+role);try{await assert.rejects(db.query('select * from vault.decrypted_secrets'),/permission denied/);}finally{await db.exec('rollback');}
 }
});

test('deployed local Edge gateway accepts issued JWTs, denies invalid/expired JWTs and enforces tenant/CORS/live gate',async()=>{
 const path='/functions/v1/job-materials/api/hq/jobs/resolve';
 const edge=(token,account=ids.a,origin='http://localhost:3000')=>request(path,{key:anon,token,method:'POST',headers:{'x-hq-account':account,origin},body:{jobNumber:'4187'}});
 const valid=await edge(sessions.u.access_token);assert.equal(valid.status,503,JSON.stringify(valid.data));assert.deepEqual(valid.data,{error:'LIVE_REQUESTS_DISABLED'});
 assert.equal((await edge('invalid')).status,401);
 assert.equal((await edge(anon)).status,401);
 const invalidSignature=sessions.u.access_token.split('.').slice(0,2).join('.')+'.'+Buffer.alloc(32).toString('base64url');assert.equal((await edge(invalidSignature)).status,401);
 const payload=JSON.parse(Buffer.from(sessions.u.access_token.split('.')[1],'base64url'));payload.exp=Math.floor(Date.now()/1000)-60;
 const unsigned=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url');
 const expired=unsigned+'.'+createHmac('sha256',config.JWT_SECRET).update(unsigned).digest('base64url');assert.equal((await edge(expired)).status,401);
 assert.ok((await auth.getUser(expired)).error);
 assert.equal((await edge(sessions.u.access_token,ids.b)).status,403);
 assert.equal((await edge(sessions.u.access_token,ids.a,'https://foreign.invalid')).status,403);
 await db.query('update public.hq_memberships set active=false where user_id=$1',[ids.u]);assert.equal((await edge(sessions.u.access_token)).status,403);
 assert.deepEqual((await request('/rest/v1/hq_accounts?select=*',{key:anon,token:sessions.u.access_token})).data,[]);
 await db.query('update public.hq_memberships set active=true where user_id=$1',[ids.u]);await db.query('update public.hq_users set disabled=true where id=$1',[ids.u]);assert.equal((await edge(sessions.u.access_token)).status,403);
});

test('real Auth + PostgREST transaction RPC creates, deduplicates and explicitly updates quantity with delta stock only',async()=>{
 const w=remote(),h=handler(w),c=await command(h);
 const first=await Promise.all(Array.from({length:8},()=>post(h,'materials',c)));const r=first.find(r=>r.status===201);assert.ok(r,JSON.stringify(first));assert.equal('unitCostCents' in r.data.material,false);
 assert.equal((await post(h,'materials',c)).data.material.id,r.data.material.id);
 const update=await command(h,'1','local-update-0001');assert.equal(update.confirmQuantityUpdate,true);
 assert.equal((await post(h,'materials',{...update,confirmQuantityUpdate:undefined})).status,409);
 const results=await Promise.all(Array.from({length:8},()=>post(h,'materials',update)));assert.ok(results.some(r=>r.status===200));
 assert.equal(w.lines.length,1);assert.equal(w.lines[0].quantity,3);assert.equal(w.calls.filter(c=>c.method==='POST').length,1);assert.equal(w.calls.filter(c=>c.method==='PUT').length,1);
 assert.deepEqual(await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances'),{on_hand:'7.00',reserved:'0.00'});
 assert.equal((await scalar('select count(*)::int n from public.hq_inventory_ledger')).n,2);
 assert.equal((await post(h,'materials/status',{idempotencyKey:c.idempotencyKey},'v',ids.b)).status,403);
 assert.equal((await post(h,'materials',c,'viewer')).status,403);
});

test('lost mock POST response holds stock; admin recovery verifies and commits once without reposting',async()=>{
 const w=remote(),h=handler(w),c=await command(h);w.setFailure('lost');assert.equal((await post(h,'materials',c)).status,409);
 assert.equal((await post(h,'materials',c)).status,409);assert.equal(w.lines.length,1);
 assert.deepEqual(await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances'),{on_hand:'10.00',reserved:'2.00'});
 w.setFailure('normal');const evidence={idempotencyKey:c.idempotencyKey,action:'verify_existing',materialId:'line-1',evidence:'Local mock read-back of exact selected material and request.'};
 assert.equal((await post(h,'materials/reconcile',evidence)).status,403);
 assert.equal((await post(h,'materials/reconcile',evidence,'admin')).data.status,'confirmed');
 assert.equal((await post(h,'materials/reconcile',evidence,'admin')).data.status,'confirmed');
 assert.equal(w.calls.filter(c=>c.method==='POST').length,1);assert.equal((await scalar('select count(*)::int n from public.hq_inventory_ledger')).n,1);
});

test('lost mock PUT response retains delta hold and reconciles without a second quantity increase',async()=>{
 const w=remote(),h=handler(w);assert.equal((await post(h,'materials',await command(h))).status,201);
 const c=await command(h,'1','local-lost-put-0001');w.setFailure('lost');assert.equal((await post(h,'materials',c)).status,409);assert.equal((await post(h,'materials',c)).status,409);
 assert.deepEqual(await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances'),{on_hand:'8.00',reserved:'1.00'});
 w.setFailure('normal');assert.equal((await post(h,'materials/reconcile',{idempotencyKey:c.idempotencyKey,action:'verify_existing',materialId:'line-1',evidence:'Local exact quantity update read-back verified.'},'admin')).data.status,'confirmed');
 assert.equal(w.lines[0].quantity,3);assert.equal(w.calls.filter(c=>c.method==='PUT').length,1);
 assert.deepEqual(await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances'),{on_hand:'7.00',reserved:'0.00'});
});

test('ledger failure rolls back real transaction and recovery only commits inventory',async()=>{
 const w=remote(),h=handler(w),c=await command(h);
 await db.exec("create function public.phase1_fail_ledger() returns trigger language plpgsql as $$begin raise exception 'LOCAL_TEST_FAILURE';end$$;create trigger phase1_fail before insert on public.hq_inventory_ledger for each row execute function public.phase1_fail_ledger();");
 try{assert.equal((await post(h,'materials',c)).data.status,'inventory_pending');assert.deepEqual(await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances'),{on_hand:'10.00',reserved:'2.00'});}finally{await db.exec('drop trigger phase1_fail on public.hq_inventory_ledger;drop function public.phase1_fail_ledger();');}
 assert.equal((await post(h,'materials/recover',{idempotencyKey:c.idempotencyKey})).data.status,'confirmed');assert.equal(w.calls.filter(c=>c.method==='POST').length,1);
});

test('concurrent real RPC claims cannot oversell, and invalid quantities never dispatch',async()=>{
 const w=remote(),h=handler(w),a=await command(h,'6','local-stock-0001'),b=await command(h,'6','local-stock-0002');
 const results=await Promise.all([post(h,'materials',a),post(h,'materials',b)]);assert.equal(results.filter(r=>r.status===201).length,1);
 assert.equal(w.calls.filter(c=>c.method==='POST').length,1);assert.deepEqual(await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances'),{on_hand:'4.00',reserved:'0.00'});
 const c=await post(h,'jobs/resolve',{jobNumber:'4187'});
 for(const quantity of ['0','-1','1.001'])assert.equal((await post(h,'materials/prepare',{confirmationId:c.data.confirmationId,sku:'ACTUAL-SKU',quantity})).status,400);
});

test('description-only duplicate candidates fail closed without mutation',async()=>{
 const w=remote(),h=handler(w);w.lines.push({id:'legacy-line',name:'Selected pump',description:'ACTUAL-SKU',kind:'materials',quantity:2,unit_price:4610,unit_cost:2300,taxable:true});
 const c=await post(h,'jobs/resolve',{jobNumber:'4187'});
 assert.equal((await post(h,'materials/prepare',{confirmationId:c.data.confirmationId,sku:'ACTUAL-SKU',quantity:'1'})).status,409);
 assert.equal(w.calls.filter(c=>['POST','PUT'].includes(c.method)).length,0);
 assert.deepEqual(await scalar('select on_hand::text,reserved::text from public.hq_inventory_balances'),{on_hand:'10.00',reserved:'0.00'});
});

test('multiple reliable pricebook identities block automatic updating through real RPC',async()=>{
 await db.exec(`update hq_private.part_costs set platform_reference='{"id":"pricebook-a","type":"pricebook_material"}'`);
 const w=remote(),h=handler(w);assert.equal((await post(h,'materials',await command(h))).status,201);
 w.lines.push({...w.lines[0],id:'second-match'});const c=await post(h,'jobs/resolve',{jobNumber:'4187'});
 const r=await post(h,'materials/prepare',{confirmationId:c.data.confirmationId,sku:'ACTUAL-SKU',quantity:'1'});assert.equal(r.status,409);assert.equal(r.data.error,'MULTIPLE_MATERIAL_MATCHES');
 assert.equal(w.calls.filter(c=>c.method==='PUT').length,0);
});

test('changed duplicate quantity needs fresh confirmation and read-back recovery never repeats PUT',async()=>{
 const w=remote(),h=handler(w);await post(h,'materials',await command(h));
 const stale=await command(h,'1','local-stale-0001');w.lines[0].quantity=5;assert.equal((await post(h,'materials',stale)).status,409);
 assert.equal(w.calls.filter(c=>c.method==='PUT').length,0);
 w.lines[0].quantity=2;const c=await command(h,'1','local-read-put-0001');const transport=w.transport;
 w.transport=async request=>{const result=await transport(request);if(request.method==='PUT')w.setFailure('read');return result;};
 const interrupted=handler(w);assert.equal((await post(interrupted,'materials',c)).data.status,'verification_pending');
 w.setFailure('normal');assert.equal((await post(h,'materials/recover',{idempotencyKey:c.idempotencyKey})).data.status,'confirmed');
 assert.equal(w.calls.filter(c=>c.method==='PUT').length,1);assert.equal(w.lines[0].quantity,3);
});
