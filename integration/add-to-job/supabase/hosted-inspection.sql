select json_build_object(
 'version',version(),'query_read_only',current_setting('transaction_read_only'),
 'cli_role_sessions',(select count(*) from pg_stat_activity where usename like 'cli_login_%'),
 'migration_history',to_regclass('supabase_migrations.schema_migrations'),
 'schemas',(select json_agg(json_build_object('name',nspname,'owner',nspowner::regrole,'acl',nspacl))
  from pg_namespace where nspname in ('public','vault','hq_private','supabase_migrations')),
 'extensions',(select json_agg(json_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname))
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
 'relations',(select json_agg(json_build_object('schema',n.nspname,'name',c.relname,'owner',c.relowner::regrole,
  'kind',c.relkind,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','vault','hq_private','supabase_migrations') and c.relkind in ('r','v','m','p','S')),
 'policies',(select json_agg(p) from pg_policies p where schemaname in ('public','vault','hq_private')),
 'functions',(select json_agg(json_build_object('schema',n.nspname,'name',p.proname,
  'arguments',pg_get_function_identity_arguments(p.oid),'owner',p.proowner::regrole,
  'security_definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl,
  'postgres_can_grant',has_function_privilege('postgres',p.oid,'EXECUTE WITH GRANT OPTION')))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','vault','hq_private')),
 'defaults',(select json_agg(json_build_object('owner',d.defaclrole::regrole,'schema',n.nspname,
  'type',d.defaclobjtype,'acl',d.defaclacl)) from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace),
 'vault_browser_access',(select json_agg(json_build_object('role',r.rolname,
  'schema_usage',has_schema_privilege(r.oid,'vault','USAGE'),
  'raw_select',has_table_privilege(r.oid,'vault.secrets','SELECT'),
  'decrypted_select',has_table_privilege(r.oid,'vault.decrypted_secrets','SELECT'),
  'executable_functions',(select json_agg(p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='vault' and has_function_privilege(r.oid,p.oid,'EXECUTE'))))
  from pg_roles r where r.rolname in ('anon','authenticated'))
) metadata;
