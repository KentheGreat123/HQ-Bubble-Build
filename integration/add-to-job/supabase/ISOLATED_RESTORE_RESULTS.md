# Hosted baseline package and isolated restore — October 11, 2026

Subsequent approved index correction:
[CORRECTED_RECOVERY_VERIFICATION.md](CORRECTED_RECOVERY_VERIFICATION.md).
Corrected verification passes 45/45 under the reviewed exact platform exceptions.
This report preserves the original 30/33 failure and its import history unchanged;
it is not the current scoped verification result.

Follow-up diagnosis: [RECOVERY_CORRECTION_PLAN.md](RECOVERY_CORRECTION_PLAN.md).
Auth migration versions match; index definitions were captured but not replayed.
The source lacks the entire local webhook schema. Storage differs by managed
migration 0073 and single-/multi-tenant Iceberg initialization. No correction was
applied; the original 30/33 result and imported target remain preserved.

Project `ixtnmcrtgcyojqrthbhw`; branch `bubble-add`.
Backup: ignored `.tooling/phase1-hosted-backups/20261012T022301087Z`.
Target: `firstrate-hq-restore-rehearsal`, strictly loopback PostgreSQL port 55452.

**Latest result: package integrity PASS; one approved local admin import PASS
(psql exit 0, committed); full source-equivalence verification FAIL (30/33 checks).**
The initial insufficient-permission attempt rolled back. The separately approved
admin retry is now consumed; neither a third import nor a database reset is allowed.
Hosted deployment remains NO-GO pending resolution of the recovery differences
and the separately approved configuration/deployment stages.

## Approved existing-local-admin attempt: completed

Before import, fresh read-only inspections under both existing local roles proved
the target unchanged from its original snapshot. Existing `supabase_admin`
authenticated with existing local credentials and had superuser, replica-mode SET,
database/public CREATE and required managed-object authority. No privilege or
credential was created to obtain that authority. Connections were restricted to
127.0.0.1:55452; the database's internal Docker port/address are distinct from that
host forwarding and do not indicate hosted access.

Role SQL review found three statement_timeout restorations (anon, authenticated,
authenticator) and one grant statement; no CREATE ROLE/password/superuser directives,
temporary CLI-role operations or external calls. All 33 COPY blocks had compatible
target columns; no nonempty source block targeted initialized nonempty data. Only
the reviewed package's settings/grants were restored, with no extra permission fix.

The guard explicitly supported this one retry: original attempt marker, independent
rollback proof, fresh unchanged-state comparison, exact backup/port, and a separate
admin-retry marker. No guard was removed or bypassed. Metadata rendering was aligned
to the original role's effective search path; differing qualification of Auth enums
was a session formatting difference, not a schema change or an ignored discrepancy.

The single-transaction import completed with exit 0. Its data is committed in the
isolated target. A second read-only connection independently reproduced the recorded
post-import inventory. No further import or corrective DDL has been executed.

### Checks that pass

- All 17 package file hashes and 18 encrypted archive entries; all five exports
  successful; stable source capture and DPAPI round-trip.
- All exported tables' row counts match. Auth users/Vault secrets remain zero;
  no HQ objects or migration ledger are present in this pre-HQ baseline.
- Public/Auth/Vault columns, table ownership/ACL/RLS, constraints, function
  permissions, triggers and schema permissions match. Public/Vault indexes match.
- All six required roles (anon, authenticated, service_role, postgres,
  supabase_auth_admin, supabase_admin), relevant memberships and policies match.
  The three restored role timeout settings were independently verified.
- Native Vault denies both browser roles schema USAGE, table access, decrypted
  SELECT and function EXECUTE. No live key or credential was imported.

### Genuine differences: not waived

| Check | Difference | Recovery implication |
| --- | --- | --- |
| Auth indexes | Source has four auth.users indexes missing locally: idx_users_created_at_desc, idx_users_email, idx_users_last_sign_in_at_desc, idx_users_name | Definitions exist in managed-schema-reference.sql. Default schema import excludes managed Auth; a reviewed additive index supplement is needed for full fidelity. Do not replay the entire managed schema. |
| Default privileges | Local supabase_admin defaults in supabase_functions exist for tables/sequences/functions; source has none for those combinations | Expanded ACL comparison confirms real extra grants, including browser roles; this is not array ordering. They predate the retry. Do not silently normalize away or change them without approval. |
| Platform counts | storage.migrations has 73 source rows versus 74 locally; two additional empty local tables, storage.iceberg_namespaces and storage.iceberg_tables | These managed tables/migration metadata were not included in data.sql. All actually exported counts match. Platform-version alignment/recovery scope must be reviewed; do not overwrite managed migration history to force equality. |

A full role comparison also identifies the source's expired cli_login_postgres
role/membership, intentionally not recreated, and local supabase_functions_admin
role/membership absent from the source. Six required role contracts match, but this
is not a byte-for-byte clone of all platform administration. No role cleanup or
creation was attempted.

Remaining discrepancies require a separately reviewed recovery supplement/platform
compatibility decision and explicit approval for any changes. The target is now an
imported database, not a pristine retry candidate. Preserve its evidence and markers;
do not reset it, remove guards, or attempt another restore under this approval.

Private evidence: admin-restore-preflight.json, admin-restore-differences.json and
post-admin-restore-verification.json under ignored .tooling/phase1-hosted-review;
restore-results.json and both attempt markers under the isolated target directory.

## Historical initial attempt

## Verified evidence

- The operator completed all five exports with exit 0. Their retained exit records
  and nonempty artifacts were verified locally, not just accepted from chat.
- All 17 manifest-listed files match their SHA-256 hashes. The DPAPI package
  decrypts under the existing Windows user and matches the ZIP byte-for-byte.
  All 18 ZIP entries (17 files plus manifest) were verified; enclosed file hashes
  and the archived manifest match the protected working copy. No contents printed.
- Pre/post source inventories match. PostgreSQL 17.11; zero Auth users, Vault
  secrets and HQ objects; no HQ migration ledger. No encryption root key needed
  for this zero-ciphertext case. This does not demonstrate future key portability.
- The target is unlinked and on 55452, with no existing HQ data/history. Source
  and target managed Auth/Vault column definitions and Vault extension version
  match before import. Auth/Vault table ownership, ACL/RLS flags and constraints
  also match. Auth/Vault function permissions, policies and triggers match.
- The guarded import used one transaction and ON_ERROR_STOP, as `postgres` on
  port 55452. It returned psql exit 3, classified as permission denied. Raw SQL
  diagnostics were withheld; the exact first failing SQL statement was not retained.
- A subsequent read-only inventory on 55452 matches every captured pre-import
  metadata field. The rollback is verified for roles/memberships, schema/table and
  function permissions, RLS/policies, defaults, constraints, indexes, triggers,
  extension inventory and row counts. Auth/Vault remain empty; no HQ objects exist.
- Both browser roles remain denied SELECT on the decrypted Vault view. The Vault
  browser-denial contract matches the source. No login/decryption fixture was made.

All private evidence remains ignored under `.tooling/phase1-hosted-review` and
`.tooling/phase1-hosted-restore`. No cloud credential, backup data or response body
was displayed or committed. Hosted resources and the existing HQ test stack on
54321/54322 were untouched; no HCP call, deployment, password reset or merge occurred.

## Confirmed privilege blocker

The prepared local `postgres` role has database/public CREATE rights, but is not
a member of `supabase_admin` and cannot SET `session_replication_role`. It also
cannot INSERT into the protected native Vault table. The restore explicitly
requires replica-mode SET; roles/schema exports also contain role configuration
and privilege restoration. A permission-denied import cannot be waived as success.

The package has no password literals or temporary CLI-role operations in its role
export. Existing local platform roles already exist; do not create a login, reset
a password, grant superuser membership, or remove protected SQL merely to proceed.

**Subsequently approved and completed:** use the existing local
`supabase_admin` role with the existing local stack password for exactly one
guarded retry on 55452. This creates no credentials and grants no privileges merely
to obtain restore authority. The import would restore the package's intended local
role settings/grants. It must never run against hosted Supabase or port 54322.
Existing local admin authentication was verified successfully; no reset or new
credential was required.

The script has an explicit `-ApprovedExistingLocalAdminRetry` switch.
It requires the existing failed-attempt marker and read-only rollback proof, refuses
a repeated admin retry, rechecks unchanged target metadata/package integrity, and
tests replica-mode authority before any import. It preserves the original inventory
and uses a separate retry marker. The switch has now been invoked exactly once;
the marker refuses another invocation.

Command used for the consumed approved retry — **do not run again**:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\kenne\HQ-Bubble-Build\integration\add-to-job\supabase\Restore-HostedBaseline.ps1" -BackupDirectory "C:\Users\kenne\HQ-Bubble-Build\.tooling\phase1-hosted-backups\20261012T022301087Z" -ApprovedExistingLocalAdminRetry
```

## Remaining recovery limitations

- The actual import passed, but full source/target equivalence has not. Missing
  managed Auth indexes and platform default-privilege/Storage differences above
  require resolution or an explicitly reviewed narrower recovery contract.
- DPAPI is bound to this Windows user's key material. A portable encrypted off-site
  copy, decryptability independent of this machine, and recovery ownership are
  still unverified. The local encrypted package alone does not close custody risk.
- Zero users cannot prove restored password/session usability; zero Vault secrets
  cannot prove encrypted-secret decryption or root-key portability. Extend recovery
  testing before real users/credentials/live operations, with separate authorization.
- SQL excludes role passwords and does not fully recover hosted Auth settings,
  signing/API keys, SMTP/runtime secrets, Edge deployments or Storage object bytes.
- Database restore cannot reverse external HCP writes. HCP remains disconnected;
  future external reconciliation needs its own approved procedure.

Invite-only hosted Auth, HTTPS callback/SMTP onboarding, production runtime origin,
fresh final migration review/dry-run, deployments and hosted ES256 acceptance remain
separate approval stages. Local CORS/security regression results remain passed in
[BASELINE_RECOVERY_RESULTS.md](BASELINE_RECOVERY_RESULTS.md).
