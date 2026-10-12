// Only the separately approved four-index correction; never a restore/reset.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import pg from 'pg';
const workspace=fileURLToPath(new URL('../../../../',import.meta.url));
const target=resolve(workspace,'.tooling/phase1-hosted-restore');
const backup=resolve(workspace,'.tooling/phase1-hosted-backups/20261012T022301087Z');
const review=resolve(workspace,'.tooling/phase1-hosted-review');
const parse=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const names=['idx_users_created_at_desc','idx_users_email','idx_users_last_sign_in_at_desc','idx_users_name'];
const marker=resolve(target,'auth-index-correction-attempted.marker');
const apply=process.argv.includes('--approved-four-index-correction');
const preflightOnly=process.argv.includes('--preflight-only');
assert([apply,preflightOnly,process.argv.includes('--verify-only')].filter(Boolean).length===1,'Choose exactly one explicit correction/preflight/verification mode');
assert(readFileSync(resolve(workspace,'.git/HEAD'),'utf8').trim()==='ref: refs/heads/bubble-add','Wrong branch');
assert(!existsSync(resolve(target,'supabase/.temp/project-ref')),'Target is linked');
assert(readFileSync(resolve(target,'supabase/config.toml'),'utf8').includes('project_id = "firstrate-hq-restore-rehearsal"'),'Wrong project identity');
if(apply)assert(!existsSync(marker),'Correction already attempted; refuse replay');
assert(existsSync(resolve(target,'admin-retry-attempted.marker')),'Expected approved import evidence missing');
const complete=parse(resolve(backup,'capture-complete.json'));
assert(complete.status==='captured'&&complete.restore_allowed,'Backup incomplete');
const manifest=parse(resolve(backup,'manifest.json'));
assert(manifest.project==='ixtnmcrtgcyojqrthbhw','Wrong backup');
for(const f of manifest.files){assert(f.file===basename(f.file),'Invalid manifest path');assert(hash(resolve(backup,f.file)).toUpperCase()===f.sha256,'Backup integrity differs');}
const preserved=parse(resolve(review,'investigation-evidence-preservation.json'));
const verifyPreserved=()=>{for(const f of preserved.preserved_files)assert(hash(resolve(target,f.file))===f.sha256,'Original recovery evidence changed');};
verifyPreserved();
const source=parse(resolve(backup,'inventory-after.json'))[0].metadata;
const original=parse(resolve(target,'inventory-after.json'));
const sourceDetails=parse(resolve(review,'recovery-source-details.json'))[0].metadata;
const platformReference=parse(resolve(review,'recovery-target-details.json'));
const indexes=source.indexes.filter(i=>i.schema==='auth'&&i.table==='users'&&names.includes(i.name));
assert(indexes.length===4,'Wrong source index set');
const draft=readFileSync(new URL('./proposed-auth-indexes.sql',import.meta.url),'utf8');
const draftCreates=[...draft.matchAll(/^CREATE INDEX .+;$/gm)].map(m=>m[0]);
assert(draftCreates.length===4&&indexes.every(i=>draftCreates.includes(i.definition+';')),'Draft differs from verified source');
const status=parse(resolve(target,'status.json')),url=new URL(status.DB_URL);
assert(url.hostname==='127.0.0.1'&&url.port==='55452'&&url.pathname==='/postgres'&&url.username==='postgres','Wrong local connection identity');
url.username='supabase_admin';
const client=new pg.Client({connectionString:url.href});
try{await client.connect();}catch{throw new Error('Existing local admin login failed; no credential changes permitted');}
const inventorySql=readFileSync(new URL('../backup-baseline-inventory.sql',import.meta.url),'utf8');
const detailsSql=readFileSync(new URL('../recovery-difference-inspection.sql',import.meta.url),'utf8');
const path=parse(resolve(review,'restore-readonly-verification.json')).canonical_search_path;
assert(Array.isArray(path)&&path.every(s=>/^[a-z_][a-z0-9_]*$/.test(s)),'Invalid reference path');
async function inspect(){
 await client.query('begin read only');
 try{
  await client.query("select set_config('search_path',$1,true)",[path.join(',')]);
  const inventory=(await client.query(inventorySql)).rows[0].metadata;
  const details=(await client.query(detailsSql)).rows[0].metadata;
  const identity=(await client.query(`select current_user,current_database() database,current_setting('server_version') version,
   (select rolsuper from pg_roles where rolname=current_user) superuser,
   has_schema_privilege(current_user,'auth','CREATE') auth_create`)).rows[0];
  await client.query('rollback');return{inventory,details,identity};
 }catch{await client.query('rollback');throw new Error('Read-only inspection failed; private SQL diagnostics withheld');}
}
let committed=false;
try{
 const pre=await inspect();
 assert(pre.identity.current_user==='supabase_admin'&&pre.identity.database==='postgres'&&pre.identity.superuser&&pre.identity.auth_create,'Existing admin permissions/identity differ');
 if(apply||preflightOnly){
  assert(equal(pre.inventory,original),'Imported target changed since reviewed snapshot');
  for(const k of Object.keys(platformReference).filter(k=>k!=='auth_indexes'))assert(equal(pre.details[k],platformReference[k]),'Managed platform precondition differs');
  assert(names.every(name=>!pre.details.auth_indexes.some(i=>i.name===name)),'Index precondition differs');
  if(preflightOnly){
   console.log('Read-only preflight PASS: exact target/backup, existing admin, unchanged imported state, four exact absent source indexes, original evidence and managed objects preserved.');
   await client.end();process.exit(0);
  }
  writeFileSync(resolve(target,'auth-index-correction-preflight.json'),JSON.stringify({target:'127.0.0.1:55452',backup:basename(backup),identity:pre.identity,source_definitions_exact:true,state_unchanged:true,preserved_evidence:true},null,2),{flag:'wx'});
  writeFileSync(marker,'Approved four-index addition only; never repeat automatically.\n',{flag:'wx'});
  console.log('Preconditions PASS: exact local target, existing admin, four source definitions, unchanged imported state and preserved evidence.');
  try{
   await client.query('begin');
   await client.query("set local lock_timeout='5s';set local statement_timeout='60s';set local search_path=pg_catalog");
   // CREATE INDEX itself takes the table lock. No persistent object/role changes
   // beyond these four definitions are issued by this runner.
   const counts=(await client.query('select (select count(*) from auth.users)::int users,(select count(*) from vault.secrets)::int secrets')).rows[0];
   assert(counts.users===0&&counts.secrets===0,'Empty baseline changed');
   for(const index of indexes)await client.query(index.definition);
   await client.query('commit');committed=true;
   writeFileSync(resolve(target,'auth-index-correction-execution.json'),JSON.stringify({committed:true,indexes:names,target:'127.0.0.1:55452',completed_utc:new Date().toISOString()},null,2),{flag:'wx'});
   console.log('Exactly four source Auth indexes committed; no grants, other objects or data changed.');
  }catch{
   await client.query('rollback');throw new Error('Four-index transaction failed and rolled back; diagnostics withheld; no automatic retry');
  }
 }
 const post=await inspect();const actual=post.inventory;
 const checks={};
 checks.correct_local_identity=post.identity.current_user==='supabase_admin'&&post.identity.database==='postgres';
 checks.zero_auth_vault_and_no_hq=actual.auth_users===0&&actual.vault_secrets===0&&actual.hq_objects===0&&!actual.history_exists;
 checks.no_nonindex_metadata_changes=Object.keys(original).filter(k=>k!=='indexes').every(k=>equal(original[k],actual[k]));
 checks.exactly_four_additive_indexes=actual.indexes.length===original.indexes.length+4&&original.indexes.every(i=>actual.indexes.some(a=>equal(a,i)));
 checks.four_indexes_exact_valid_owned=indexes.every(i=>post.details.auth_indexes.some(a=>a.name===i.name&&a.definition===i.definition&&a.owner==='supabase_auth_admin'&&a.valid&&a.ready&&!a.unique&&!a.constraint_backed));
 for(const schema of ['public','auth','vault'])for(const kind of ['columns','tables','functions','constraints','indexes','triggers'])checks[schema+'_'+kind+'_matches_source']=equal(source[kind]?.filter(o=>o.schema===schema),actual[kind]?.filter(o=>o.schema===schema));
 checks.rls_policies_match=equal(source.policies,actual.policies);
 const appRoles=['anon','authenticated','service_role','postgres','supabase_auth_admin','supabase_admin'];
 checks.required_roles_match=equal(source.roles.filter(r=>appRoles.includes(r.name)),actual.roles.filter(r=>appRoles.includes(r.name)));
 checks.required_memberships_match=equal(source.memberships.filter(r=>appRoles.includes(r.role)&&appRoles.includes(r.member)),actual.memberships.filter(r=>appRoles.includes(r.role)&&appRoles.includes(r.member)));
 checks.critical_schema_permissions_match=equal(source.schemas.filter(s=>['public','auth','vault'].includes(s.name)),actual.schemas.filter(s=>['public','auth','vault'].includes(s.name)));
 checks.vault_browser_denials_match=equal(source.vault_browser_denials,actual.vault_browser_denials)&&actual.vault_browser_denials.every(d=>!d.usage&&!d.ciphertext&&!d.decrypted);
 const dataSql=readFileSync(resolve(backup,'data.sql'),'utf8');
 const copyTables=[...dataSql.matchAll(/^COPY\s+"?([A-Za-z0-9_]+)"?\."?([A-Za-z0-9_]+)"?\s+\(/gm)].map(m=>m[1]+'.'+m[2]);
 checks.exported_counts_match=copyTables.length===33&&copyTables.every(name=>{const a=source.counts.find(o=>o.schema+'.'+o.table===name),b=actual.counts.find(o=>o.schema+'.'+o.table===name);return a&&b&&a.count===b.count;});
 const countExceptions=['storage.migrations','storage.iceberg_namespaces','storage.iceberg_tables'];
 checks.no_unapproved_count_differences=equal(source.counts.filter(o=>!countExceptions.includes(o.schema+'.'+o.table)),actual.counts.filter(o=>!countExceptions.includes(o.schema+'.'+o.table)));
 for(const key of Object.keys(platformReference).filter(k=>k!=='auth_indexes'))checks['platform_'+key+'_unchanged']=equal(post.details[key],platformReference[key]);
 const common=sourceDetails.storage_migrations;
 const extras=post.details.storage_migrations.filter(m=>!common.some(s=>s.id===m.id));
 checks.storage_exact_approved_migration_difference=common.every(m=>post.details.storage_migrations.some(a=>equal(m,a)))&&extras.length===1&&extras[0].id===73&&extras[0].name==='revoke-grants-to-unused-operations'&&extras[0].hash==='ba9244051be09f22f714fc0170a2539f8b5f0e68';
 checks.iceberg_exact_empty_rls_objects=['iceberg_namespaces','iceberg_tables'].every(name=>!source.tables.some(t=>t.schema==='storage'&&t.name===name)&&actual.tables.some(t=>t.schema==='storage'&&t.name===name&&t.rls)&&actual.counts.some(t=>t.schema==='storage'&&t.table===name&&t.count===0));
 const defaultsExceptions=d=>d.role==='supabase_admin'&&d.schema==='supabase_functions'&&['S','f','r'].includes(d.type);
 checks.nonexcepted_defaults_match=equal(source.default_privileges,actual.default_privileges.filter(d=>!defaultsExceptions(d)));
 checks.exact_webhook_default_exceptions=actual.default_privileges.filter(defaultsExceptions).length===3&&equal(original.default_privileges.filter(defaultsExceptions),actual.default_privileges.filter(defaultsExceptions))&&sourceDetails.functions_schema===null;
 checks.nonexcepted_roles_match=equal(source.roles.filter(r=>r.name!=='cli_login_postgres'),actual.roles.filter(r=>r.name!=='supabase_functions_admin'));
 const membershipException=m=>(m.role==='postgres'&&m.member==='cli_login_postgres')||(m.role==='supabase_functions_admin'&&m.member==='postgres');
 checks.nonexcepted_memberships_match=equal(source.memberships.filter(m=>!membershipException(m)),actual.memberships.filter(m=>!membershipException(m)));
 verifyPreserved();checks.original_seven_evidence_files_preserved=true;
 const apiConfig=readFileSync(resolve(target,'supabase/config.toml'),'utf8');
 checks.webhook_schema_not_in_api_config=/schemas\s*=\s*\["public"\]/.test(apiConfig);
 const pass=Object.values(checks).every(Boolean);
 const report={verification_contract:'reviewed-source-recovery-with-exact-managed-platform-exceptions',target:'127.0.0.1:55452',backup:basename(backup),checked_utc:new Date().toISOString(),pass,checks,passed_checks:Object.values(checks).filter(Boolean).length,total_checks:Object.keys(checks).length,approved_exceptions:{webhook_module:'source absent; target existing module/defaults/role/membership preserved exactly',storage_migration:extras,storage_empty_tables:['storage.iceberg_namespaces','storage.iceberg_tables'],source_expired_cli_role:'not recreated'},original_report_preserved:true,original_report_result:'30/33 FAIL',full_platform_clone_verified:false,limitations:['Zero users: restored real login/session recovery unproven','Zero ciphertext: Vault key portability/decryption recovery unproven','Portable encrypted off-site recovery unverified','Role passwords, API/signing keys, hosted settings, SMTP/runtime secrets, Edge deployment and Storage bytes need separate recovery'],correction_committed:committed||existsSync(resolve(target,'auth-index-correction-execution.json'))};
 writeFileSync(resolve(target,'corrected-recovery-verification.json'),JSON.stringify(report,null,2));
 writeFileSync(resolve(target,'corrected-inventory.json'),JSON.stringify(actual,null,2));
 console.log(JSON.stringify({corrected_verification_pass:pass,passed_checks:report.passed_checks,total_checks:report.total_checks,failed_checks:Object.keys(checks).filter(k=>!checks[k]),original_report_preserved:true,full_platform_clone_verified:false}));
 if(!pass)process.exitCode=1;
}finally{await client.end();}
