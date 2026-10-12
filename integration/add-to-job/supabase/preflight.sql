-- Metadata only. Run with an EXISTING database login; never mint a CLI login role.
-- No customer rows, secret values, or function bodies are selected.
begin read only;
select current_database(),current_user,version(),current_setting('transaction_read_only');
select nspname,nspowner::regrole,nspacl from pg_namespace
 where nspname in ('public','auth','vault','hq_private','supabase_migrations');
select e.extname,e.extversion,n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace
 where e.extname in ('supabase_vault','pgsodium','pgtap');
select n.nspname,c.relname,c.relkind,c.relowner::regrole,c.relrowsecurity,c.relforcerowsecurity,c.relacl
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','hq_private','vault','supabase_migrations')
 and c.relkind in ('r','v','m','S','p') order by n.nspname,c.relname;
select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
 where schemaname in ('public','hq_private','vault') order by schemaname,tablename,policyname;
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) arguments,
 p.proowner::regrole,p.prosecdef,p.proconfig,p.proacl
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','hq_private','vault') order by n.nspname,p.proname;
select r.rolname,r.rolsuper,r.rolbypassrls from pg_roles r
 where r.rolname in ('postgres','supabase_admin','anon','authenticated','service_role');
select d.defaclrole::regrole,n.nspname,d.defaclobjtype,d.defaclacl
 from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace;
select to_regclass('supabase_migrations.schema_migrations') migration_history;
-- If the preceding relation exists, separately SELECT version,name from it.
-- Stop on ANY existing HQ objects, overlapping migration versions, unexpected
-- public objects, or shared Vault consumers before migration planning proceeds.
rollback;
