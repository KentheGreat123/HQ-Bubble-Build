// Disposable native PostgreSQL rehearsal only; Auth/Vault are test fixtures.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {Client} from 'pg';
import {asUser,ids,workflow,principal} from './support.mjs';
const mode=process.argv[2],baseline=process.argv[3];
assert.ok(['capture','verify'].includes(mode)&&baseline,'Mode and baseline file required');
const url=new URL(process.env.HQ_NATIVE_TEST_URL||'http://invalid');
assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname==='/hq_phase1_test'
 &&url.port===(mode==='capture'?'55439':'55440'),'Only dedicated source/restore loopback databases allowed');
const client=new Client({connectionString:url.href});await client.connect();
const db={query:(...a)=>client.query(...a),exec:sql=>client.query(sql)};
// pg_dump can restore an explicit owner-only ACL as NULL (the same default).
// Compare expanded grants, including grant options, rather than raw encoding.
const acl=(column,owner,kind)=>`(select json_agg(json_build_object(
 'grantor',a.grantor::regrole::text,'grantee',case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end,
 'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee::regrole::text,a.privilege_type)
 from aclexplode(coalesce(${column},acldefault('${kind}',${owner}))) a)`;
try{
 const tables=(await db.query(`select n.nspname,c.relname,c.relowner::regrole::text owner,
  c.relrowsecurity,c.relforcerowsecurity,${acl('c.relacl','c.relowner','r')} acl from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and (n.nspname='hq_private' or n.nspname='public' and c.relname like 'hq_%')
  order by n.nspname,c.relname`)).rows;
 const functions=(await db.query(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) arguments,
  p.proowner::regrole::text owner,p.prosecdef,p.proconfig,${acl('p.proacl','p.proowner','f')} acl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','hq_private','auth','vault') order by n.nspname,p.proname,arguments`)).rows;
 const policies=(await db.query(`select * from pg_policies where schemaname in ('public','hq_private')
  order by schemaname,tablename,policyname`)).rows;
 const schemas=(await db.query(`select nspname,nspowner::regrole::text owner,${acl('nspacl','nspowner','n')} acl
  from pg_namespace where nspname in ('public','hq_private','auth','vault') order by nspname`)).rows;
 const roles=(await db.query(`select rolname,rolsuper,rolcanlogin,rolinherit,rolbypassrls,rolcreaterole,rolcreatedb
  from pg_roles where rolname in ('hq_local','anon','authenticated','service_role') order by rolname`)).rows;
 const snapshot={tables,functions,policies,schemas,roles};
 assert.equal(tables.length,16);assert.ok(tables.every(t=>t.relrowsecurity&&t.relforcerowsecurity));
 if(mode==='capture'){
  writeFileSync(baseline,JSON.stringify(snapshot,null,2));
  console.log('Captured local fixture owner, ACL, RLS, policy and role baseline.');
 }else{
  assert.deepEqual(snapshot,JSON.parse(readFileSync(baseline,'utf8')),'Restored owners, grants, roles, RLS and policies must match');
  const rights=(await db.query(`select
   has_function_privilege('service_role','public.hq_backend(uuid,uuid,text,jsonb)','EXECUTE') server,
   has_function_privilege('authenticated','public.hq_backend(uuid,uuid,text,jsonb)','EXECUTE') client,
   has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') secret`)).rows[0];
  assert.deepEqual(rights,{server:true,client:false,secret:false});
  assert.equal((await asUser(db,ids.u,'select * from public.hq_catalog_parts')).rows.length,1);
  assert.equal((await asUser(db,ids.v,'select * from public.hq_catalog_parts')).rows.length,0);
  await assert.rejects(asUser(db,ids.u,'update public.hq_inventory_balances set on_hand=99'),/permission denied/);
  await assert.rejects(asUser(db,ids.u,'select * from vault.decrypted_secrets'),/permission denied/);
  const w=workflow(db),status=await w.service.submissionStatus(principal,{idempotencyKey:'native-restart-request-0001'});
  assert.equal(status.status,'reconciliation_required');
  await assert.rejects(w.service.recoverInventory(principal,{idempotencyKey:'native-restart-request-0001'}),e=>e.code==='MANUAL_RECONCILIATION_REQUIRED');
  assert.equal(w.calls.length,0,'Restore/recovery must make no remote request');
  assert.deepEqual((await db.query('select on_hand::text,reserved::text from public.hq_inventory_balances')).rows[0],{on_hand:'8.00',reserved:'1.00'});
  assert.equal((await db.query('select count(*)::int n from public.hq_inventory_ledger')).rows[0].n,1);
  await assert.rejects(db.exec('delete from public.hq_inventory_ledger'),/APPEND_ONLY/);
  console.log('PASS: fresh-cluster restore preserves role/owner/ACL/RLS/policies, tenant isolation, stock/ledger and uncertain holds; zero remote requests.');
 }
}finally{await client.end();}
