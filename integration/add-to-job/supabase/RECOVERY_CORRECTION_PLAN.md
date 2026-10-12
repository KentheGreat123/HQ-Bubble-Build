# Recovery differences: diagnosis and proposed correction

Subsequently approved and completed: [CORRECTED_RECOVERY_VERIFICATION.md](CORRECTED_RECOVERY_VERIFICATION.md).
Only the four source indexes were added. Corrected verification passes 45/45;
managed objects/permissions and the original 30/33 report remain unchanged.
The proposal and reasoning below are preserved as the review history.

October 11, 2026; branch `bubble-add`; project `ixtnmcrtgcyojqrthbhw`.
Preserved backup `20261012T022301087Z`; preserved imported target 127.0.0.1:55452.
**Investigation only: no DDL, grants, object recreation, resets or repeat imports.**

The strict original result remains **30/33, FAIL**. The three failed categories
combine one missing source-schema supplement with two local/hosted platform
initialization differences. Do not convert that historical result to 33/33 by
deleting platform metadata or silently skipping checks.

## 1. Four source Auth indexes

All four are on `auth.users`, owned by `supabase_auth_admin`, valid/ready,
nonunique and not constraint-backed. They exist in the captured and currently
inspected source; they are absent from the imported local target:

| Index | Exact indexed value |
| --- | --- |
| auth.idx_users_created_at_desc | created_at DESC, btree |
| auth.idx_users_email | email, btree |
| auth.idx_users_last_sign_in_at_desc | last_sign_in_at DESC, btree |
| auth.idx_users_name | raw_user_meta_data ->> 'name'::text, btree, only non-NULL names |

**Cause:** Auth migration versions match exactly (82 records). Default `schema.sql`
excludes managed Auth; these four definitions are present in the explicit
`managed-schema-reference.sql` but that reference was deliberately not replayed
wholesale. This is a restore-procedure omission of a captured supplement, not lost
backup data. The catalog does not record who originally created each index; their
platform/dashboard versus manual provenance cannot be proven from these records.
Matching Auth migrations plus different additive indexes do not establish an Auth
binary-version problem. The restore omission itself is directly verified.

**Impact:** lookup/sorting performance and source-schema fidelity. Their absence
does not change uniqueness, RLS, authorization, password/session semantics or Vault
encryption. Preserve them for complete Auth schema recovery and future user volume.

**Safest correction, pending approval:** add exactly those four source definitions
to the existing imported local database using existing local admin authority.
Do not recreate `auth.users`, restore all managed Auth DDL, use IF NOT EXISTS to
hide a wrong definition, or repeat COPY/import. The draft
[proposed-auth-indexes.sql](recovery/proposed-auth-indexes.sql) is outside the three
HQ migrations and has not run. Its future runner must independently pin port 55452,
backup hash/source definitions, current imported state, and explicit authorization.
The SQL fails on collisions; a transaction bounds all four additions. Recheck
definition, ownership, validity/readiness, constraints and RLS afterward.

Supabase documents separate restoration of managed-schema customizations; its
default CLI export filters managed schemas. [Restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[CLI 2.120.0 filters](https://raw.githubusercontent.com/supabase/cli/v2.120.0/apps/cli-go/pkg/migration/dump.go).

## 2. supabase_functions defaults and actual objects

The **source has no supabase_functions schema** in the backup or current hosted
catalog. The target already had that schema and its defaults before either import.
This is the database-webhook module, separate from the job-materials Edge Function.

Exact differing defaults are for creator `supabase_admin`, schema
`supabase_functions`, and object types `r` (tables), `S` (sequences), `f` (functions).
The target grants postgres, anon, authenticated and service_role table ALL,
sequence SELECT/UPDATE/USAGE, and function EXECUTE. There are no corresponding
source defaults because the schema is absent. The source's other admin defaults
are captured separately; no global default resolves this table/sequence difference.

Target-only objects include `supabase_functions.hooks` and `.migrations` (owned by
supabase_functions_admin; RLS off; client grants), `.http_request()` (a SECURITY
DEFINER trigger function with client EXECUTE), the schema, and its admin role and
membership. The catalog inspection did not execute this function or any network
routine. No hook data or authorization values were printed.

**Cause:** local managed webhook initialization, not a newly introduced restore
grant or missing customer backup data. Supabase's official Docker bootstrap creates
the exact schema, defaults, objects and role pattern. The schema export filters
internal schemas/ACL operations and does not remove local modules absent on source.
[Official webhook bootstrap](https://raw.githubusercontent.com/supabase/supabase/master/docker/volumes/db/webhooks.sql),
[schema filtering](https://raw.githubusercontent.com/supabase/cli/v2.120.0/apps/cli-go/pkg/migration/scripts/dump_schema.sh).

**Impact:** a real local permission surface, not harmless ACL array ordering.
Defaults affect future objects made by their creator in that schema; current object
grants remain separate. Revoking only defaults would neither remove current grants
nor reproduce a source where the schema never existed. In particular, function
PUBLIC EXECUTE has PostgreSQL default semantics that a simple missing-ACL test
must not interpret as automatic denial. [PostgreSQL default privileges](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).

Public/Auth/Vault permissions and client Vault denial still match; the restored
local API config exposes only public, and these webhook objects do not supply HQ
tenant authorization or an HCP key. Their absence from REST exposure is not a
substitute for database permissions. Do not use this local-only module in HQ,
expose it through an API, copy its grants to hosted settings, or infer webhook
security parity. No HQ webhook is part of Phase 1.

**Safest correction:** preserve the managed module and identify it as a specific
target-only platform exception in the recovery contract. Keep exact comparison
for public/Auth/Vault, app roles and all nonexcepted privileges. Verify API schema
exposure and no HQ dependencies separately. Do not revoke platform grants, drop
the schema/admin role, or rerun bootstrap to force raw equality. If exact webhook
platform parity is required, obtain a supported initialization/provider plan under
separate approval; targeted hardening is separate work, not a required data restore.

## 3. Storage ledger and Iceberg tables

### Version/migration difference

`storage.migrations`: source has 73 rows; target has 74. All common migration
IDs/names/hashes match. The only additional target row is:

- id **73**, name **revoke-grants-to-unused-operations**,
  hash **ba9244051be09f22f714fc0170a2539f8b5f0e68**.

This is Storage managed migration `0073`, not the PostgreSQL major version or HQ
migration ledger. Source and target PostgreSQL versions match; that alone does
not imply identical managed-service schema versions. The migration removes unused
client table privileges and limits vector-table grants. Read-only inspection
confirms target anon/authenticated lack TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on
storage.objects, buckets and buckets_analytics. It is a permission-tightening
platform revision, not an omitted user row.
[Official 0073 migration](https://raw.githubusercontent.com/supabase/storage/master/migrations/tenant/0073-revoke-grants-to-unused-operations.sql).

### Initialization-mode difference

`storage.iceberg_namespaces` and `storage.iceberg_tables` are absent on source,
present and empty locally. The source and target share migration 0038 and later
Iceberg migration records. Official 0038 creates these tables only when
`storage.multitenant` is false; 0047/0048 also branch on this mode. Their observed
presence matches single-tenant local versus managed multi-tenant initialization.
That mode explanation is an inference from the documented migration branches and
catalog state; the original migration session's setting was not retained.
The extra 0073 migration changes grants and **does not create these two tables**.
[0038 creation branch](https://raw.githubusercontent.com/supabase/storage/master/migrations/tenant/0038-iceberg-catalog-flag-on-buckets.sql),
[0047 branch](https://raw.githubusercontent.com/supabase/storage/master/migrations/tenant/0047-iceberg-table-metadata.sql),
[0048 branch](https://raw.githubusercontent.com/supabase/storage/master/migrations/tenant/0048-iceberg-catalog-ids.sql).

**Backup coverage:** managed Storage schema/migration metadata is initialized by
the target; storage.migrations was not included in data.sql. The two extra tables
do not exist in the source and therefore contain no source data to recover. All
33 exported COPY tables' counts match. This excludes neither customer bucket/object
records from essential restoration nor object bytes from separate custody.

**Impact:** platform version/topology parity and later Storage/analytics service
compatibility, not current HQ authentication, RLS or Vault recovery. HQ Phase 1 does
not use Iceberg; the restore stack's Storage service is excluded. No claim of
end-to-end Storage/analytics recovery is made. Future use needs service-version,
policy and object-byte recovery testing.

**Safest correction:** preserve the local ledger and tables. Never delete migration
73, insert old ledger rows over it, drop empty managed tables, downgrade services,
or replay Storage DDL merely to get equal counts. In a reviewed recovery contract,
compare exported data and source application dependencies exactly; record these
specific managed differences with names/hash, RLS/emptiness and compatibility limits.
If identical Storage topology is required, separately plan a supported version/mode
alignment; no reset or alternate target is authorized in this investigation.

## Essential restoration versus platform metadata

Essential: package integrity; exported rows and identities; public/Auth/Vault
definitions and indexes; owners, effective grants, policies/forced RLS; required
roles/memberships; credential linkage and eventual encryption context; all actual
customer Storage metadata/object bytes if used. Current empty Auth/Vault cannot
prove password login or encrypted-secret recovery.

Platform-specific: managed Storage's own migration ledger/mode-specific empty
Iceberg tables; unused local webhook module/creator defaults/admin role; expired
source CLI login role. Preserve/report these, not overwrite them. An approved
exception must be exact and cannot ignore arbitrary future changes in those schemas.

## Minimum next action

Approve **a four-index additive supplement on the existing 55452 target**, plus
the explicit version/topology-aware verification contract above. Then run only
that bounded supplement and fresh read-only comparisons, keeping all original
30/33 reports and both restore guards untouched. This is not another restore.
No new privilege grants, credentials, plan upgrade or PITR purchase is needed.

Report separate outcomes: source-equivalent HQ/Auth/Vault recovery, identified
managed-platform exceptions, and unresolved off-site/nonempty Auth/Vault recovery.
Do not claim full hosted-platform clone parity or rewrite the old 33-check result.
If exact platform equality is mandatory, there is no supported minimum SQL patch
identified here; preserve this target and seek an approved compatible platform plan.

No correction has been applied. Read-only reinspection independently matched the
preserved post-import snapshot. Seven original evidence/guard files were hashed
without rewriting them; new investigation evidence is ignored under .tooling.
Hosted resources, old HQ tests, production HQ/Android and Git history are unchanged.
