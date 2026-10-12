-- Run only on a disposable LOCAL Supabase stack: supabase test db.
-- Native Auth/Vault extension checks supplement the embedded/native PostgreSQL suite.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
select has_table('public','hq_accounts','Accounts migration installed');
select has_table('hq_private','material_submissions','Durable private submissions installed');
select ok((select bool_and(c.relrowsecurity and c.relforcerowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind='r' and (n.nspname='hq_private' or (n.nspname='public' and c.relname like 'hq_%'))),'All HQ tables enforce RLS');
select ok(not has_function_privilege('authenticated','public.hq_backend(uuid,uuid,text,jsonb)','EXECUTE'),'User role cannot invoke server RPC');
select ok(not has_function_privilege('anon','public.hq_backend(uuid,uuid,text,jsonb)','EXECUTE'),'Anonymous role cannot invoke server RPC');
select ok(has_function_privilege('service_role','public.hq_backend(uuid,uuid,text,jsonb)','EXECUTE'),'Server RPC is explicitly granted');
select ok(not has_table_privilege('authenticated','vault.decrypted_secrets','SELECT'),'Vault plaintext inaccessible to browser role');
select vault.create_secret('phase1-fake-fixture-not-an-hcp-key','hq-phase1-vault-fixture');
select ok((select secret <> 'phase1-fake-fixture-not-an-hcp-key' from vault.secrets where name='hq-phase1-vault-fixture'),'Native Vault stores ciphertext');
select is((select decrypted_secret from vault.decrypted_secrets where name='hq-phase1-vault-fixture'),'phase1-fake-fixture-not-an-hcp-key','Native Vault decrypts the local fixture');
select * from finish();
rollback;
