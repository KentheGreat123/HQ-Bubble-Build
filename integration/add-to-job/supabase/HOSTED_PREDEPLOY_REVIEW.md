# Final hosted Phase 1 pre-deployment review — October 11, 2026

Latest recovery gate: [CORRECTED_RECOVERY_VERIFICATION.md](CORRECTED_RECOVERY_VERIFICATION.md).
The four-index supplement is approved/applied locally and corrected verification
passes 45/45 with exact platform exceptions. Original 30/33 evidence is retained.
Off-site/nonempty-data recovery and hosted configuration/deployment remain pending;
earlier statements below about failed or pending local recovery are historical.

Latest recovery evidence: [ISOLATED_RESTORE_RESULTS.md](ISOLATED_RESTORE_RESULTS.md).
The baseline package is captured and integrity-verified. Its first isolated import
rolled back; the approved local admin retry imported successfully. Full equivalence
still fails on three checks (30/33 pass); the retry is consumed. Hosted deployment
stays NO-GO. Earlier pending-capture/privilege statements are historical.

Current authorized preparation status:
[BASELINE_RECOVERY_RESULTS.md](BASELINE_RECOVERY_RESULTS.md). The CORS revision
now permits `x-client-info` and enforces the production-only deployment origin.
Its local tests pass; capture/restore is pending the operator's terminal execution.
The runtime hash-match statements below describe the earlier reviewed revision;
the three migration hashes remain unchanged. No hosted settings were applied.

**NO-GO for deployment. Corrected local code/security checks pass; a restorable
hosted baseline and approved hosted Auth/runtime configuration are still missing.**

Latest preparation: [HOSTED_EXECUTION_PLAN.md](HOSTED_EXECUTION_PLAN.md) and
[HOSTED_CONFIGURATION_DRAFT.json](HOSTED_CONFIGURATION_DRAFT.json). Read-only
inspection confirms the Free plan and zero Auth users/Vault secrets. Logical
backup plus an isolated local restore is the proposed path; PITR is not required.
Production origin only is approved; testing origins and Auth callbacks remain
pending. Staff invitation delivery requires an approved SMTP/callback setup.
Standard browser SDK use also needs `x-client-info` added to the function's CORS
headers and verified before frontend activation. No runtime code was changed.

Project: `ixtnmcrtgcyojqrthbhw`. Branch: `bubble-add`. Inspection began at
7:56 PM CDT on October 11, 2026. Only Management API GETs, public JWKS GET,
and metadata SELECTs with `read_only=true` were executed. No migrations, function
deployments, settings changes, credentials, HCP requests, production HQ changes,
commits, pushes, or merges were made in this review.

Updated after the user reported a successful guarded dry-run. Auth/backup/function
metadata and read-only database metadata were refreshed at approximately 8:15 PM
CDT on October 11, 2026. All 17 reviewed runtime/migration hashes remain unchanged.

## Corrected migration and code review

- Exactly three local migration files exist, in the expected order below.
- All 17 migration/shared-source/function files match the copies used by the
  successful local Supabase tests byte for byte. `config.toml` also matches.
  No runtime or migration code was changed during this review.
- Each migration is an atomic DO statement. New HQ tables immediately enable
  and force RLS and revoke client grants before publication. Migration 2 grants
  policy-filtered SELECT; migration 3 grants the transactional RPC only to
  `service_role`. SECURITY DEFINER routines pin their search path to pg_catalog.
- Vault's corrected function loop touches only functions with effective client
  EXECUTE access; it does not grant extra access to managed crypto helpers. Its
  final assertion checks schema/table/function client privileges exhaustively.
  Hosted anon/authenticated roles currently have no Vault access, so the loop
  selects no hosted Vault functions. Owner-only encrypt/nonce helpers are skipped.
- No account, user, catalog, credential, active connection, or HCP data is seeded.
  No network extension, webhook, scheduler, or external HTTP operation is created.

| Migration | SHA-256 |
| --- | --- |
| `202610110001_schema.sql` | `69C218237C082E2BC33483EB1EE1E8483A037405E0BE6836A4FAB652457B94CD` |
| `202610110002_security.sql` | `7BB1FA4D4EFE30530D6785B0C081F50BACD1D6F20208AEE7F248C75515C8321D` |
| `202610110003_transactions.sql` | `CFBCFA9A0841411690FD52CC4D184B96D05B6042207BE337E355AA6167E281D3` |

Local execution evidence remains [LOCAL_SUPABASE_RESULTS.md](LOCAL_SUPABASE_RESULTS.md):
12 real Supabase tests, 9 pgTAP checks, and the full regression suites passed.

## Hosted dry-run

**PASS — user-reported guarded hosted dry-run of the corrected revision.**
The user supplied the following successful output on October 11, 2026:

```text
DRY RUN: migrations will not be pushed to the database.
Connecting to remote database...
Would push these migrations:
- 202610110001_schema.sql
- 202610110002_security.sql
- 202610110003_transactions.sql
Finished supabase db push.
```

Exactly three expected migrations appear in the expected order, and the supplied
output contains no login-role initialization message. This clears the updated
planner gate. It is user-reported execution, not an agent-executed dry-run or a
hosted SQL apply test. The earlier dry-run of the old revision is no longer the
readiness evidence for this gate.

There is no existing database password in this process or backend env files.
The user chose to run the guarded dry-run in their own terminal. The prepared
script is `.tooling/phase1-hosted-review/Run-HostedDryRun.ps1`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File C:\Users\kenne\HQ-Bubble-Build\.tooling\phase1-hosted-review\Run-HostedDryRun.ps1
```

It validates the branch, linked project, reviewed/tested file hashes, CLI binary,
and exact three-file set, then reads the existing password using a hidden prompt.
It supplies the password through a process environment variable and restores
that variable afterward. It invokes only:

```powershell
& $cli db push --linked --dry-run --skip-vault --workdir $backend
```

Reviewed CLI 2.120.0 source uses a supplied nonempty password without minting a
temporary login. Its dry-run branch precedes Vault synchronization, migration
history DDL, SQL apply, custom roles, and seed mutations. The script also sets a
read-only PGOPTIONS value; the reviewed branch is the primary mutation guard.
Do not run an unguarded linked command if the existing password is unavailable.
Do not reset passwords, create a login role, repair history, or use `--include-all`.

The new output meets the expected three-file condition. A fresh read-only query
after that report confirms no HQ objects/history and zero active CLI-role sessions.
The preceding role-metadata snapshot showed the old CLI-role password expired;
no role creation, password rotation, or credential change was performed here.

CLI integrity: published ZIP checksum
`0DB5224FC5D92AE5F15E675ED65DAD376967326921122AB8D9A78E790874C92E`;
executable checksum, verified against the ZIP member,
`1CBEDD6E494581A1C1D90113660113A06798D9967D19C857127B66B8A428E836`.
These are different files; the dry-run guard uses the executable checksum.

## Hosted configuration and compatibility

| Check | Current result |
| --- | --- |
| Project | ACTIVE_HEALTHY, us-east-1 |
| Database | PostgreSQL 17.11 / release 17.11.0.003; same major/minor as tested locally |
| Auth service | GoTrue v2.197.0, healthy; same version as local image |
| Required extensions | plpgsql 1.0, pgcrypto 1.3, supabase_vault 0.3.1 installed; gen_random_uuid and auth.uid available |
| Existing application objects | No public application tables/functions, HQ schema, or migration ledger |
| Managed migration rights | postgres has database/public CREATE, Auth USAGE and user REFERENCES, Vault secret REFERENCES, and delegated Vault USAGE/SELECT grants |
| Browser roles | anon/authenticated: no LOGIN, superuser, or BYPASSRLS; Vault schema/plaintext/functions denied |
| Server role | service_role has BYPASSRLS, as expected; backend must keep that key server-side |
| Data API schemas | public,graphql_public; private/Vault schemas excluded, confirmed by service health metadata |
| Vault dependencies | Only native decrypted-view and nonce-default dependencies appeared; no public application consumer detected |
| Edge functions | None deployed |
| Auth signup | Enabled; anonymous signup disabled; email login enabled; email confirmation required |
| Auth URLs | http://localhost:3000; redirect allow list empty |
| Sessions | JWT expiration 3600 seconds; refresh reuse interval 10 seconds |
| JWT signing | ES256 in use; HS256 previously used; public JWKS matches active ES256 key ID |
| Runtime custom configuration | HQ_ALLOWED_ORIGINS absent from listed hosted secret names |
| Database SSL enforcement | Disabled at project level; use and verify TLS for database connections |

The dedicated config REST endpoints returned 404; exposed schemas were independently
confirmed from healthy REST service metadata. No secret values, Auth user rows,
password hashes, or Vault plaintext were selected.

Current official documentation says the platform's `verify_jwt=true` check accepts
both legacy HS256 and asymmetric signing keys. Keep it enabled and retain the
handler's Auth `getUser` check. Local tests used HS256; no new hosted session was
issued in this read-only review. A valid ES256-session smoke test remains an
acceptance check after separately approved deployment.
[JWT platform check](https://supabase.com/docs/guides/functions/auth-headers).

The tested local Edge runtime 1.77.4 / Deno 2.1.4 ran the pinned SDK and shared
imports. The exact hosted Edge runtime build is not observable without a deployed
function here. CLI source supports source imports outside the function directory
within the project/git root; the proposed API deployment includes shared src files.
[CLI deployment implementation](https://github.com/supabase/cli/blob/v2.120.0/apps/cli/src/shared/functions/deploy.ts).

Hosted runtime supplies SUPABASE_URL, SUPABASE_ANON_KEY, and
SUPABASE_SERVICE_ROLE_KEY by default. Their absence from custom-secret listing is
not evidence of missing built-ins. Set the approved exact HTTPS CORS origin
separately; localhost examples are not hosted configuration.
[Runtime environment variables](https://supabase.com/docs/guides/functions/secrets).

## Recovery capability and proposed plan

The backup API reports `walg_enabled=true`, `pitr_enabled=false`, zero backup
records, and no physical recovery-window timestamps. Backup-schedule access
returns HTTP 402. This does not establish a usable restore point, retention, or
plan entitlement. Do not treat WAL-G being enabled as a verified recovery plan.

The supported choices are an accessible managed backup/restore point, or a secure
logical export with a tested restore. Paid-plan retention varies; free-tier
projects are advised to export backups. Storage object bytes require separate
coverage. [Backup capabilities](https://supabase.com/docs/guides/platform/backups).

Proposed recovery procedure, **not yet verified or executed**:

1. Project owner selects the recovery operator/approver, isolated restore target,
   acceptable recovery point, and downtime budget. Obtain separate approval for
   target provisioning, encryption-context transfer, or any hosted restore/settings
   operation. None is authorized by this report.
2. Immediately before apply, capture a complete logical roles/schema/data baseline
   using an existing database login, or verify an accessible managed restore point.
   Include Auth data, Vault ciphertext, owners/ACLs/policies, shared schemas, and
   migration history when present. Encrypt and checksum artifacts outside source.
3. Preserve the Vault encryption context securely. A SQL dump alone cannot recover
   ciphertext without its root key. Managed clone/branch flows copy encryption
   context; a manual restore requires explicit handling. Do not print/export
   plaintext credentials into source/logs.
4. Restore into the approved isolated environment. Verify row counts, owners,
   ACLs, tenant denials, real Auth usability, Vault decryption, ledger/holds, and
   migration history. Capture procedure, target, artifact checksums, elapsed time,
   operator, and pass/fail evidence.
5. Use that tested procedure for an explicitly approved recovery decision. A whole
   project restore can overwrite other post-backup writes. Preserve unknown HCP
   states/holds; never infer that a database restore undoes an upstream write.

The official procedure requires separate roles/schema/data files and preservation
of encryption context; configuration outside the database needs separate records.
[Logical backup/restore procedure](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
The earlier local restart and fixture-restore tests do not satisfy this hosted gate.

Recovery gate closure requires a recorded backup identifier or complete encrypted
export, its capture time and integrity checks, a named recovery operator, and a
successful isolated restore result covering real Auth and Vault encryption context.
Retention/entitlements and recovery time must also be recorded. None of that hosted
recovery evidence currently exists in this review. PITR is one possible capability,
not a mandatory purchase: a complete, tested logical backup can satisfy the gate.
Do not reset the existing database password or assume that an empty public schema
means Auth, Vault, or other managed schemas contain no data.

## Remaining Auth/runtime requirements

| Requirement | Required state / evidence | Classification |
| --- | --- | --- |
| Closed onboarding | Disable self-service signup; keep anonymous signup disabled and email login enabled. Require email confirmation and controlled, server-assigned memberships. Current signup is enabled. | Before deployment/activation; settings changes need approval |
| Auth URLs | Choose the intended HTTPS Auth client, site URL, and exact confirmation/invitation/callback allow list. Current localhost URL and empty allow list are development defaults. Do not assume the production HQ frontend already implements Supabase Auth. | Approved hosted configuration required |
| CORS | Configure HQ_ALLOWED_ORIGINS with the approved exact HTTPS origin(s), no wildcard. It is currently absent. The current WebView origin is documented in the deployment commands as a candidate, not an approved staging-client choice. | Before browser API activation; runtime setting needs approval |
| Signing and session validation | Retain active ES256 signing, verify_jwt=true, and handler getUser validation. Do not rotate keys or disable verification to work around a 401. | Compatibility supported by current documentation; actual-session acceptance remains |
| Runtime keys | Use platform-injected server keys; no service-role or HCP secret in client code, source, request logs, or APK. Confirm required variables are present without logging their values. | Acceptance check after approved function deployment |
| TLS | Use verified TLS for database administration. Hosted project-wide SSL enforcement is currently off; changing it requires a separate settings decision. | Connection requirement; no setting changed |
| Invite delivery | Select controlled provisioning/invitation flow and verify delivery before onboarding. Current email-send limit is 2/hour; no invitation or test email was sent. | Before onboarding; delivery testing requires authorization |
| Hosted smoke tests | Validate a real ES256 user session, invalid/expired rejection, tenant/RPC denial, exact CORS, and LIVE_REQUESTS_DISABLED. Inspect actual function version and verify_jwt setting. | After explicitly approved deployment, before declaring hosted acceptance |

The post-deployment smoke checks are not a demand to deploy during this read-only
review. They are acceptance criteria for the later approved change. Local config
and function deployment do not automatically correct hosted Auth settings.

## HCP remains disconnected

The entrypoint hardcodes `enableLiveRequests:false`, `enableLiveWrites:false`, and
`approvedTestJobIds:[]`. The transport rejects before fetching or retrieving an
HCP key. No environment variable can enable those gates. SQL only persists state;
it does not call HCP. Empty migrations create no active company/credential binding.
Deploying this exact revision therefore cannot enable live Add to Job. Credential
creation/binding and live reads/writes remain separately reviewed and approved work.

## Exact future deployment commands — NOT EXECUTED

Run only after the dry-run/recovery/configuration gates pass and explicit approval
is granted for this project and these exact hashes. Auth signup/invitation and HTTPS
URL changes require a separately approved settings operation; local config is not
automatically applied to hosted Auth by database/function deployment.

```powershell
$cli = 'C:\Users\kenne\HQ-Bubble-Build\.tooling\supabase\supabase.exe'
$backend = 'C:\Users\kenne\HQ-Bubble-Build\integration\add-to-job'
$project = 'ixtnmcrtgcyojqrthbhw'
# Verify branch, link, exact three files and reviewed hashes again.
# Set SUPABASE_DB_PASSWORD from a secure prompt using the EXISTING password.
# Do not put a password in command arguments, source, or transcripts.
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_PASSWORD)) { throw 'Existing DB password required' }
$env:SUPABASE_PROJECT_ID = $project
& $cli db push --linked --dry-run --skip-vault --workdir $backend
if ($LASTEXITCODE -ne 0) { throw 'Dry-run failed' }

# STOP: separate explicit approval is required before these cloud changes.
& $cli db push --linked --skip-vault --workdir $backend
if ($LASTEXITCODE -ne 0) { throw 'Apply failed; inspect state, do not reset/repair' }

# Separate approval for exact-origin runtime configuration; no HCP credential.
& $cli secrets set HQ_ALLOWED_ORIGINS=https://kenthegreat123.github.io --project-ref $project --workdir $backend
if ($LASTEXITCODE -ne 0) { throw 'Runtime origin configuration failed' }

# Separate Edge deployment approval; verify_jwt=true is retained in config.
& $cli functions deploy job-materials --project-ref $project --workdir $backend --use-api
if ($LASTEXITCODE -ne 0) { throw 'Function deployment failed' }
# Clear/restore password and project environment variables in finally.
```

The GitHub origin above is the current HQ WebView origin, not an Auth redirect
path. Confirm it against the intended approved staging client before configuring.
Do not use `--include-all`, seed/role inclusion, `--no-verify-jwt`, `--prune`,
hosted reset, or migration-history repair. After approved deployment, inspect exact
history/hashes, grants/RLS, function verify_jwt status, and authenticated responses
with HCP gates still closed before tenant onboarding or Phase 2 activation.

**Final assessment: NO-GO for hosted Phase 1 deployment.** The corrected migration
review, local execution, exact file matching, managed-role privilege review, and
new guarded dry-run gates pass. Remaining pre-deployment gates are verified
backup/restore and approved closed Auth/HTTPS/runtime configuration. The planned
ES256/runtime smoke tests follow an approved deployment and precede hosted
acceptance. No demonstrated migration defect remains. HCP activation and Phase 2
frontend wiring remain separately approved work; no cloud-changing action was
performed or authorized by this report.
