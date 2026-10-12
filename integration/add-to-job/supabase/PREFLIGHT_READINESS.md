# Phase 1 deployment readiness — 2026-10-11

**Historical preflight snapshot. Current readiness is recorded in
[HOSTED_PREDEPLOY_REVIEW.md](HOSTED_PREDEPLOY_REVIEW.md).** Real local Supabase
tests now pass, and the user reported a successful guarded dry-run of the
corrected migrations listing exactly the three expected files. Current remaining
deployment gates are verified recovery and approved hosted Auth/runtime configuration.
The observations and older checksums below describe the earlier revision.

**NO-GO for the three hosted migrations. The user-reported hosted dry-run succeeded; native Supabase execution/security tests and verified backup/recovery remain deployment gates.**

Work remained on `bubble-add`. Existing Android/frontend changes were preserved.
No hosted migration, Edge deployment, hosted Auth setting change, HCP request,
customer job write, commit, merge, or push was performed.

## Important preflight incident

Supabase CLI 2.120.0 was downloaded from the official release and verified against
its published SHA-256 checksum:
`0db5224fc5d92ae5f15e675ed65dad376967326921122ab8d9a78e790874c92e`.

The official `db query` SIDE_EFFECTS.md describes linked queries as Management API
requests. However, the actual query.handler.ts, lines around 259–266, first calls
the linked database connection resolver, explicitly including temporary login-role
minting. The metadata SELECT printed **“Initialising login role...”** before
returning. Subsequent direct Management API inspection with `read_only=true`
confirmed the role `cli_login_postgres` exists. The CLI requests `read_only:false`
when minting this role. Its password expired at **2026-10-11 4:56:34 PM CDT**
(21:56:34 UTC). It has LOGIN but no direct superuser, CREATE ROLE, CREATE DATABASE,
replication or BYPASSRLS flag. It has non-inherited membership in `postgres`
with SET ROLE permission and no ADMIN OPTION, so it is privileged when usable.
The follow-up snapshot around 5:02 PM CDT showed **zero CLI-role sessions**.
No password, token, secret value or password hash was printed or saved in source.

No cleanup is required solely to stop an already expired password with no active
sessions in that snapshot. The role remains present and privileged; expiration
does not revoke its membership or prevent an independently authorized future CLI
request from refreshing it. No deletion, rotation, revocation or new role was
performed during the follow-up inspection. Removal is optional administrative
cleanup requiring separate approval. This is a dated observation, not continuous
monitoring or proof about sessions created after that snapshot.

Do not repeat `db query --linked`, `migration list --linked`, or `db push --linked
--dry-run` without reviewing their connection resolver and using an existing
database login, or a directly verified Management API path that does not mint a
database role. A dry-run protects migration execution, but does not necessarily
prevent credential side effects during connection setup. The user subsequently
reported a successful hosted dry-run using the guarded existing-password workflow.
No attempt was made to delete/revoke the expired role, because that would be a
cloud modification requiring separate approval.

Sources:
- [Official query implementation](https://github.com/supabase/cli/blob/v2.120.0/apps/cli/src/commands/db/query/query.handler.ts)
- [Official query side-effect summary](https://github.com/supabase/cli/blob/v2.120.0/apps/cli/src/commands/db/query/SIDE_EFFECTS.md)
- [Official push implementation](https://github.com/supabase/cli/blob/v2.120.0/apps/cli/src/command-internal/db-push-core.ts)

## Hosted inspection and successful dry-run

- Correct project: `ixtnmcrtgcyojqrthbhw`, `ACTIVE_HEALTHY`, us-east-1.
- PostgreSQL 17.11, compatible with the local major-version 17 configuration.
- Hosted Edge Function list: empty.
- Schemas: auth, extensions, graphql, graphql_public, public, realtime, storage, vault.
- No public application tables, HQ private schema, or `supabase_migrations` schema
  appeared in the metadata inspection. Thus no standard migration-history table
  exists; no remote migration-history rows could be read.
- Only inspected application/Vault/history relation objects were standard
  `vault.secrets` and `vault.decrypted_secrets`, owned by `supabase_admin`.
  Their returned ACLs grant postgres delegated read/delete/truncate/reference
  rights and service_role read/delete; no anon/authenticated entries appeared.
- No secret values or customer rows were selected.

The initial workspace-root link was corrected by explicitly linking
`C:\Users\kenne\HQ-Bubble-Build\integration\add-to-job` to
`ixtnmcrtgcyojqrthbhw`. The backend's `supabase/.temp/project-ref` was verified.
The original root cache was preserved. Use the backend `--workdir` for future
commands. The local config keeps `project_id = "firstrate-hq-local"`.

The direct read-only API returned `transaction_read_only = on`. Inspection
covered public/private/Vault relations and functions, ACLs, policies, default
privileges, extension versions and standard migration-history presence. There
were no public application relations/functions or HQ objects, no application RLS
policies, and no standard migration-history relation. `supabase_vault` is version
0.3.1. No conflicting application objects appeared in this inspected scope.

The hosted public default grants give anon/authenticated broad table and function
privileges. These are an expected Supabase baseline, but unsafe for unprotected
new tables: the atomic migration hardening explicitly revokes those grants before
publication. No existing hosted grants were changed during inspection.

Vault's schema, tables and decrypted view deny anon/authenticated access; those
roles also cannot execute its functions. `postgres` has delegated grant authority
on schema usage, table read/delete/truncate/reference permissions, and
create_secret/update_secret/decrypt EXECUTE. It lacks grant authority on Vault's
internal encrypt/nonce functions, which are already owner-only. The broad REVOKE
may therefore warn for those helpers; the migration's fail-closed access assertion
must be exercised under actual managed privileges. Service-role Vault access
remains server-side. No secret values were selected.

Hosted Auth/signing configuration, other schemas' application dependencies on
Vault, and execution of the migrations as a managed Supabase database role remain
unverified. Metadata inspection and a CLI planner do not prove execution success.

The user reported this successful hosted dry-run on 2026-10-11:

```text
DRY RUN: migrations will not be pushed to the database.
Would push these migrations:
- 202610110001_schema.sql
- 202610110002_security.sql
- 202610110003_transactions.sql
```

This is **user-reported command output**, not an agent-executed deployment or SQL
execution test. It confirms all three pending filenames and order. It does not
validate SQL bodies, managed-role permissions, Vault behavior, RLS enforcement,
or rollback/restore. Current migration checksums still match those below.

## Local security changes

Each of the three existing migration files is now one atomic `DO` statement.
Even an autocommit runner cannot publish a partially hardened migration.
Each CREATE TABLE is followed inside that statement by ENABLE/FORCE RLS and
revocation of PUBLIC/anon/authenticated grants. Migration 1 leaves every HQ table
closed; migration 2 publishes only policy-filtered authenticated SELECT access;
migration 3 publishes the transactional RPC only to service_role.

Private helper EXECUTE grants are revoked before migration 1 can commit.
Vault schema, raw/encrypted table, decrypted view, and all Vault functions deny
PUBLIC/anon/authenticated. A final assertion fails the entire schema migration
if inherited client Vault access remains, including when REVOKE only warns due
to missing grant options. This deliberately affects shared Vault permissions:
existing consumers and actual grant authority must be reviewed before deployment.

No default privileges of unrelated production objects are changed by the
migrations. Tests deliberately use permissive default grants and check all
16 tables and Vault grants after each migration. A late injected schema error
proves that HQ objects and Vault grant changes roll back together.

## Verification completed

Latest runtime and fresh-cluster recovery rehearsal: [LOCAL_RECOVERY.md](LOCAL_RECOVERY.md).

| Check | Result |
|---|---|
| Backend regression, SQLite compatibility, mock integrations, UI controllers, atomic migration rollback | 67 passed |
| PGlite actual migration/Auth-role/Vault-fixture/RLS/transaction suite, including final fail-closed guard | 36 passed |
| Native PostgreSQL 17.11 migration/RLS/transaction suite | 36 passed |
| Native independent-session duplicate/stock/update contention | 5 passed |
| Native fresh-cluster backup/restore: roles, owners, ACLs, RLS, tenant isolation and uncertainty | Passed with Auth/Vault fixtures |
| Deno Edge entrypoint type check | Passed |
| Deno runtime authentication guards and asynchronous workflow | 2 passed |
| Real Supabase Auth token issuance / JWT gateway | Not run |
| Native Supabase Vault encryption / pgTAP | Not run |
| Hosted migration dry-run | Passed, user-reported: exactly all three expected files in order |

The relevant regression, embedded/native PostgreSQL, contention and Deno checks
were rerun during the latest local preparation. Native tests now include the final
Vault fail-closed assertion. A fresh separate PostgreSQL cluster restore passed
permission, RLS, isolation, inventory and uncertain-submission verification.
Auth fixtures are not real Supabase Auth, and the test Vault fixture is plaintext.
Do not interpret these results as proof of native Vault encryption or gateway JWT
compatibility. Android was not rebuilt or changed in this task.

Docker Desktop 4.94.0 installed successfully through winget, with verified
installer hash. Docker client 29.8.2 is available, but the local engine returned
HTTP 500 and Desktop status `stopped`. WSL was reported uninstalled. No Windows
restart was performed. Full Supabase-stack checks need a working container runtime.

## Exact proposed database changes

Pending local order (no hosted apply occurred):

1. `202610110001_schema.sql` — private schema, Vault extension if missing,
   16 immediately protected tables, tenant foreign keys, checks, indexes, five
   integrity/append-only triggers, three trigger functions, Vault access hardening.
2. `202610110002_security.sql` — four authorization helpers, nine authenticated
   SELECT policies, explicit grants, private helper permissions and secret denial.
3. `202610110003_transactions.sql` — service_role-only `public.hq_backend` RPC
   for current membership/role authorization, tenant-bound credential retrieval,
   confirmation/quote validation, reservations, durable claims, dispatch/remote-ID
   persistence, verified confirmation, atomic inventory/ledger/audit, and recovery.

Public tables: hq_accounts, hq_users, hq_memberships, hq_platform_connections,
hq_catalog_parts, hq_inventory_locations, hq_inventory_balances,
hq_inventory_ledger, hq_audit_records.

Private tables: credential_secrets, connection_credentials, part_costs,
job_confirmations, material_quotes, material_submissions, inventory_reservations.

Fresh hosted deployment would also require the CLI's migration-history schema
and table. No migration seeds accounts, inserts credentials, deletes customer
rows, truncates tables, or replaces existing application tables. CREATE TABLE is
intentionally not IF NOT EXISTS: conflicting objects must stop deployment.
Hosted ACL/default-grant metadata was inspected without changes. Shared-schema dependencies and actual managed-role execution still need validation.

SHA-256 in migration order:
- `67912B0CD08C70E35AFE0FA725BEC065D0DCFE029EF2DC05830385F2F677D4FD`
- `7BB1FA4D4EFE30530D6785B0C081F50BACD1D6F20208AEE7F248C75515C8321D`
- `CFBCFA9A0841411690FD52CC4D184B96D05B6042207BE337E355AA6167E281D3`

## Remaining deployment blockers - NO-GO

1. **Real local Supabase migration/Vault/security execution.** Get Docker/WSL
   operational and apply all three unchanged migrations on a disposable local
   Supabase stack. Run native Vault encryption/decryption, browser-role denials,
   tenant isolation, service-role RPC transactions and recovery. Exercise the
   final fail-closed guard and SECURITY DEFINER/FORCE RLS behavior using privileges
   equivalent to hosted postgres, rather than relying on a test superuser.
   Review shared Vault consumers before any broad ACL change. Correct failures
   locally and rerun affected tests; a changed migration needs a fresh dry-run.
2. **Real Auth/JWT and Edge integration tests.** Test issued Supabase sessions,
   anonymous/expired/forged tokens, disabled users, missing/foreign memberships,
   and the Edge JWT gateway/signing-key compatibility. The completed Auth fixtures
   and Deno tests do not replace these tests. This is also a gate for end-to-end
   Phase 1/API activation; database-only deployment would not make Add to Job live.
3. **Verified pre-deployment backup and restore rehearsal.** The metadata snapshot
   is a partial schema/ACL baseline, not a restorable backup. Confirm backup
   availability/retention and capture the complete database/schema/privilege
   baseline, including Auth and required shared schemas. Verify recovery of Vault
   ciphertext and its required encryption context without exporting plaintext
   credentials into source/logs. Restore into an isolated environment and record
   the exact procedure, recovery owner, target and result. A schema-only dump is
   insufficient. A native fixture backup/restore has now passed in a fresh cluster
   (see LOCAL_RECOVERY.md); real Supabase Auth/Vault restoration and hosted backup
   readiness remain unproven.

Resolved planning issues: backend link scope is correct; the CLI role was
inspected and its password was expired with zero active sessions at the snapshot;
hosted metadata/privileges and standard history absence were inspected; the
user-reported dry-run lists exactly the expected three migrations. Credential
cleanup is not a current mandatory blocker based on that snapshot. No remaining
code defect has been demonstrated, but the execution/security gaps above prevent
an unconditional GO. The latest local checks passed; full Supabase-stack tests remain blocked by
uninstalled WSL and a stopped Docker engine. No system-level installation or
feature enabling was performed in that turn.

After these gates pass, obtain explicit approval for the three migrations to
this exact project. Edge deployment, hosted Auth changes, credentials and live
HCP testing remain separate approvals. Never use cloud reset, fixture seeding,
--include-all or migration-history repair to bypass conflicts.

Local verification commands (not executed in this report update):

```powershell
$cli = 'C:\Users\kenne\HQ-Bubble-Build\.tooling\supabase\supabase.exe'
$backend = 'C:\Users\kenne\HQ-Bubble-Build\integration\add-to-job'
& $cli link --workdir $backend --project-ref ixtnmcrtgcyojqrthbhw
& $cli start --workdir $backend
& $cli db reset --local --workdir $backend
& $cli test db --local --workdir $backend
# Existing DB password must be supplied securely via SUPABASE_DB_PASSWORD;
# absent it, linked DB commands can mint a cloud login role. Never print it.
& $cli db push --linked --dry-run --skip-vault --workdir $backend
```

No deployment command is authorized by this report. Hosted Auth redirects,
signup/invite policy, user/account provisioning, CORS, signing-key compatibility,
Vault credential creation and a designated HCP test job each remain separate
configuration/approval steps. HCP reads and writes are still hard-disabled in
the Edge entrypoint, so Phase 1 deployment alone will not enable live Add to Job.

## Rollback and recovery plan

Before any apply, complete the backup/restore gate above and record schema
owners/ACLs/policies and exact migration history, especially shared Vault grants.
The existing read-only metadata snapshot can seed that baseline but cannot serve
as a complete backup or restoration test.
Each file is atomic: a failure rolls back that file, but earlier completed files
may remain. Migration 1 is closed by default, so an interrupted sequence does
not expose new HQ tables. Do not blindly reapply if history and objects disagree.

After an approved deployment failure, keep live HCP disabled and suspend material
submission through an approved operational change. Preserve holds and uncertain
submissions; never retry POST/PUT or release dispatched inventory holds merely
because a response was lost. Prefer reviewed forward-fix migrations. Do not drop
HQ tables, reset cloud, or repair history to hide partial deployment. Restore
previous shared Vault ACLs only from the captured baseline with separate approval.
A full backup restore requires an explicit recovery decision because it can
overwrite subsequent writes in other project schemas.
