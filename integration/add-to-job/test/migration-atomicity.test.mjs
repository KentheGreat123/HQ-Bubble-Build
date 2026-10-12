import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('late schema migration failure publishes no HQ objects or Vault privilege changes',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create schema auth;create table auth.users(id uuid primary key);
   create schema vault;create table vault.secrets(id uuid primary key);
   create view vault.decrypted_secrets as select * from vault.secrets;
   grant usage on schema vault to authenticated;
   alter default privileges grant all on tables to anon,authenticated;`);
  const migration=readFileSync(new URL('../supabase/migrations/202610110001_schema.sql',import.meta.url),'utf8')
   .replace('create extension if not exists supabase_vault with schema vault;','-- Embedded test fixture only.')
   .replace(/end;\s*\$hq_migration\$;\s*$/,"raise exception 'TEST_LATE_FAILURE';\nend;\n$hq_migration$;");
  await assert.rejects(db.exec(migration),/TEST_LATE_FAILURE/);
  const {rows}=await db.query(`select to_regnamespace('hq_private') private_schema,
   to_regclass('public.hq_accounts') accounts,
   has_schema_privilege('authenticated','vault','USAGE') original_vault_usage`);
  assert.deepEqual(rows[0],{private_schema:null,accounts:null,original_vault_usage:true});
 }finally{await db.close();}
});
