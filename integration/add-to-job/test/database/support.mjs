import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {createBackendRpc,PostgresSubmissionStore,PostgresInventory} from '../../src/postgres-store.mjs';
import {MaterialService} from '../../src/material-service.mjs';
import {JobMaterialsRegistry} from '../../src/job-materials.mjs';
import {HousecallProJobMaterialsAdapter} from '../../src/hcp-adapter.mjs';
import {HcpClient} from '../../src/hcp-client.mjs';

export const ids={a:'00000000-0000-4000-8000-000000000001',b:'00000000-0000-4000-8000-000000000002',
 u:'00000000-0000-4000-8000-000000000011',v:'00000000-0000-4000-8000-000000000012',admin:'00000000-0000-4000-8000-000000000013',viewer:'00000000-0000-4000-8000-000000000014',
 c:'00000000-0000-4000-8000-000000000021',d:'00000000-0000-4000-8000-000000000022',l:'00000000-0000-4000-8000-000000000031',p:'00000000-0000-4000-8000-000000000041',secret:'00000000-0000-4000-8000-000000000051'};
export const principal={id:ids.u,accountId:ids.a};
export async function database({onMigration}={}){
 let db;
 if(process.env.HQ_NATIVE_TEST_URL){
  const url=new URL(process.env.HQ_NATIVE_TEST_URL);
  if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/hq_phase1_test')throw new Error('Native tests require a dedicated localhost /hq_phase1_test database');
  const {Client}=await import('pg');const client=new Client({connectionString:url.href});await client.connect();
  db={query:(...args)=>client.query(...args),exec:sql=>client.query(sql),close:()=>client.end()};
 }else db=new PGlite();
 // Test-only Auth/Vault scaffolding. This does NOT test Supabase Auth/JWT or
 // native Vault encryption. Production migrations use the real extension.
 await db.exec(`do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema vault;create table vault.secrets(id uuid primary key,decrypted_secret text not null);
 create view vault.decrypted_secrets as select * from vault.secrets;
 create function vault.test_secret_mutator() returns void language sql as $$select$$;
 grant usage on schema vault to public,anon,authenticated;
 grant all on vault.secrets,vault.decrypted_secrets to public,anon,authenticated;
 -- Deliberately permissive defaults model a dangerous hosting baseline.
 alter default privileges grant all on tables to anon,authenticated;
 alter default privileges grant execute on functions to anon,authenticated;`);
 const dir=new URL('../../supabase/migrations/',import.meta.url);
 for(const file of readdirSync(dir).sort()){
  let sql=readFileSync(new URL(file,dir),'utf8');
  sql=sql.replace('create extension if not exists supabase_vault with schema vault;','-- Native Vault is substituted ONLY in the embedded SQL test harness.');
  await db.exec(sql);
  await onMigration?.(db,file);
 }
 return db;
}
export async function seed(db){
 await db.exec(`truncate public.hq_accounts,public.hq_users,auth.users,vault.secrets cascade;
 begin;
 insert into auth.users values('${ids.u}'),('${ids.v}'),('${ids.admin}'),('${ids.viewer}');
 insert into public.hq_users values('${ids.u}','Technician A',false),('${ids.v}','Technician B',false),('${ids.admin}','Admin A',false),('${ids.viewer}','Viewer A',false);
 insert into public.hq_accounts(id,name) values('${ids.a}','Account A'),('${ids.b}','Account B');
 insert into public.hq_memberships values('${ids.a}','${ids.u}','technician',true),('${ids.a}','${ids.admin}','admin',true),('${ids.a}','${ids.viewer}','viewer',true),('${ids.b}','${ids.v}','technician',true);
 insert into public.hq_platform_connections(id,account_id,platform,external_account_id,status) values('${ids.c}','${ids.a}','housecallpro','company-a','active'),('${ids.d}','${ids.b}','housecallpro','company-b','active');
 update public.hq_accounts set active_connection_id=case when id='${ids.a}' then '${ids.c}'::uuid else '${ids.d}'::uuid end,materials_enabled=true;
 insert into public.hq_catalog_parts values('${ids.p}','${ids.a}','ACTUAL-SKU','Selected pump',4610,true,1,true);
 insert into hq_private.part_costs values('${ids.a}','${ids.p}',2300,null);
 insert into public.hq_inventory_locations values('${ids.l}','${ids.a}','Van A','${ids.u}');
 insert into public.hq_inventory_balances values('${ids.a}','${ids.l}','${ids.p}',10,0);
 insert into vault.secrets values('${ids.secret}','fake-test-key-only');
 insert into hq_private.credential_secrets values('${ids.secret}','${ids.a}');
 insert into hq_private.connection_credentials values('${ids.a}','${ids.c}','${ids.secret}');
 commit;`);
}
export function adminClient(db){return{async rpc(name,p){
 try {const r=await db.query(`select public.hq_backend($1::uuid,$2::uuid,$3::text,$4::jsonb) as value`,[p.p_actor,p.p_account,p.p_op,JSON.stringify(p.p_args)]);return{data:r.rows[0].value,error:null};}
 catch(error){return{data:null,error:{message:error.message,code:error.code}};}
}};}
export function workflow(db,options={}){
 const p=options.principal||principal,admin=adminClient(db),rpc=createBackendRpc(admin,p);
 const store=new PostgresSubmissionStore({rpc,principal:p}), inventory=new PostgresInventory({rpc,principal:p});
 const calls=[],lines=[];let lost=false,readFailure=false,postFailure=false;
 const rawJob={id:'job-a',invoice_number:'4187',company_id:'company-a',customer:{first_name:'Sample',last_name:'Customer'},address:{street:'Test street'}};
 const transport=async req=>{
  calls.push(structuredClone(req));
  if(req.method==='PUT'){
   const id=decodeURIComponent(req.path.split('/').at(-1)),item=lines.find(line=>line.id===id);
   if(!item)return{status:404,body:{}};Object.assign(item,req.body);
   if(lost)throw new Error('fake update response lost');return{status:200,body:structuredClone(item)};
  }
  if(req.method==='POST'){
   if(postFailure)throw new Error('fake POST failure');
   const item={id:'line-'+(lines.length+1),...req.body};lines.push(item);
   if(lost)throw new Error('fake response lost');return{status:201,body:item};
  }
  if(req.path.endsWith('/line_items')) {if(readFailure&&lines.length)throw new Error('fake GET failure');return{status:200,body:{data:structuredClone(lines)}};}
  return{status:200,body:req.path.startsWith('/jobs?')?{page:1,total_pages:1,jobs:[rawJob]}:rawJob};
 };
 const registry=new JobMaterialsRegistry({housecallpro:conn=>new HousecallProJobMaterialsAdapter({client:new HcpClient({transport:options.transport||transport}),externalAccountId:conn.externalAccountId})});
 const service=new MaterialService({registry,store,inventory,authorizeAction:(_,action)=>rpc('authorize',{action}),authorizeJob:()=>rpc('authorize',{action:'jobs:read'}),getPart:sku=>rpc('part',{sku})});
 async function command(quantity='2',key='postgres-request-0001'){
  const c=await service.resolveJob(p,'4187'),selection={confirmationId:c.confirmationId,sku:'ACTUAL-SKU',quantity};
  const q=await service.prepareMaterial(p,selection);return{...selection,quoteId:q.quoteId,idempotencyKey:key,...(q.operation==='update'?{confirmQuantityUpdate:true}:{})};
 }
 return{p,admin,rpc,service,store,inventory,registry,command,calls,lines,transport,
  setFailure(mode){lost=mode==='lost';readFailure=mode==='read';postFailure=mode==='post';}};
}
export async function asUser(db,uid,sql){
 await db.exec('begin;set local role authenticated;');
 try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);return await db.query(sql);}
 finally{await db.exec('rollback');}
}
