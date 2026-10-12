# Permanent HQ backend: Phase 1 runbook

Current checkpoint/deployment authority: [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md).
Exact proposed source list: [PHASE1_CHECKPOINT_FILES.txt](PHASE1_CHECKPOINT_FILES.txt).
Portable custody: [PORTABLE_OFFSITE_BACKUP.md](PORTABLE_OFFSITE_BACKUP.md).
The paragraphs below describe historical stages; earlier pending-work statements
are superseded by the current checklist and corrected 45/45 report.

Latest result: [CORRECTED_RECOVERY_VERIFICATION.md](CORRECTED_RECOVERY_VERIFICATION.md).
The approved four Auth indexes are restored and corrected recovery verification
passes 45/45 with exact managed-platform exceptions. Original 30/33 evidence is
unchanged. Off-site/nonempty Auth/Vault recovery and hosted configuration/deployment
remain separate gates; no cloud resources changed.

Read-only recovery investigation and minimum proposed correction:
[RECOVERY_CORRECTION_PLAN.md](RECOVERY_CORRECTION_PLAN.md). Four source Auth
indexes need a bounded supplement; webhook defaults and Storage ledger/tables
come from differing managed initialization. No correction or repeat import applied.

Latest package/restore result: [ISOLATED_RESTORE_RESULTS.md](ISOLATED_RESTORE_RESULTS.md).
Backup integrity passes. The approved existing-local-admin import succeeded;
full verification fails on managed Auth indexes and platform differences (30/33
checks pass). The one retry is consumed; hosted deployment remains NO-GO.

Current backup/CORS preparation and execution status:
[BASELINE_RECOVERY_RESULTS.md](BASELINE_RECOVERY_RESULTS.md). CORS is corrected
locally and security/regression tests pass; guarded baseline capture and isolated
restore still require operator execution and verified results. No hosted change.

Prepared execution plan: [HOSTED_EXECUTION_PLAN.md](HOSTED_EXECUTION_PLAN.md).
The organization is confirmed Free; PITR is not required. The plan covers a logical
backup/local restore of the current zero-user/zero-Vault-secret baseline,
production-only origins, dashboard/CLI responsibilities, and callback, SMTP,
managed Vault import, and browser SDK CORS limitations. No changes were executed.

Latest read-only hosted review: [HOSTED_PREDEPLOY_REVIEW.md](HOSTED_PREDEPLOY_REVIEW.md).
It records active ES256 signing, hosted signup/URL gaps, absent restore points,
matched local-test hashes, and exact future deployment commands. Deployment
remains NO-GO; no cloud-changing action was performed.

Latest local results: [LOCAL_SUPABASE_RESULTS.md](LOCAL_SUPABASE_RESULTS.md).
The real Auth/Vault/RLS/JWT/Edge/RPC local gate now passes. Native testing found
and fixed a Vault migration permission failure and a local email-provider flag.
The corrected guarded hosted dry-run passed, as reported by the user. Hosted
deployment remains NO-GO pending verified target backup/restore and approved
hosted Auth/runtime configuration described in the latest hosted review.

Windows runtime prerequisites and the tested native database recovery rehearsal
are documented in [LOCAL_RECOVERY.md](LOCAL_RECOVERY.md).

Earlier security-hardening and cloud-preflight results are in
[PREFLIGHT_READINESS.md](PREFLIGHT_READINESS.md). The user-reported hosted dry-run
predates the native Vault migration fix. Real local Supabase security execution
now passes, and the corrected guarded dry-run passed as reported by the user.
The current recommendation remains NO-GO pending target backup/restore and
hosted configuration requirements in the latest hosted review.
Linked database commands require an existing password to avoid temporary-role
creation. The earlier temporary role was inspected and its password was expired
with zero active sessions at the recorded snapshot.

Local implementation only. No cloud provisioning/deployment, real HCP key,
real HCP request, production change or Android/frontend edit occurred in this
phase. Read [SCHEMA.md](SCHEMA.md) and [PHASE1_VERIFICATION.md](PHASE1_VERIFICATION.md).

## Runtime and API

The existing platform-independent MaterialService and HCP adapter run in a
Supabase Deno Edge Function. Shared code uses Web Crypto and Fetch. SQLite stays
in existing mock/regression tests; the Edge runtime uses asynchronous PostgREST
RPC persistence and PostgreSQL transactions. No separate Node server is needed.
ServiceTitan remains unimplemented. The SDK and Deno dependencies are pinned.

The Edge entrypoint hard-disables HCP reads and writes. No environment switch
enables them. Future activation requires a reviewed, separately approved change.

Each JSON POST needs a non-anonymous Auth bearer token and `X-HQ-Account` UUID.
SQL checks current roles. Bodies are limited to 16 KiB and CORS to exact origins.

| Path after `/functions/v1/job-materials` | Body/work |
| --- | --- |
| `/api/hq/jobs/resolve` | `{jobNumber}`; exact lookup and expiring confirmation. |
| `/api/hq/materials/prepare` | `{confirmationId,sku,quantity}`; authoritative quote. |
| `/api/hq/materials` | Selection plus `{quoteId,idempotencyKey}`; submit/verify/confirm. |
| `/api/hq/materials/status` | `{idempotencyKey}`; durable status. |
| `/api/hq/materials/recover` | `{idempotencyKey}`; GET/inventory recovery, no repeat POST. |
| `/api/hq/materials/reconcile` | Admin: `{idempotencyKey,action,materialId?,evidence}`; `verify_existing` or `release_undispatched`. |

Confirmed creation is 201; confirmed quantity update is 200; pending is 202. Errors are
sanitized codes. Internal cost, credentials and raw upstream errors are excluded
from HTTP responses.

Duplicate-material requirements and tested behavior are in
[PHASE1_VERIFICATION.md](PHASE1_VERIFICATION.md). Update quotes expose old,
additional and total quantities and require `confirmQuantityUpdate:true` at
submission. Unmapped legacy identities and multiple matches block automatically;
updates use documented PUT, never POST. Inventory uses only the additional amount.

## Automated local checks

Node 24+ is required. All HCP traffic below is mock-only.

```powershell
Set-Location C:\Users\kenne\HQ-Bubble-Build\integration\add-to-job
npm.cmd ci --ignore-scripts
npm.cmd test
npm.cmd run test:database
$env:DENO_DIR = 'C:\Users\kenne\HQ-Bubble-Build\.tooling\deno-cache'
.\node_modules\@deno\win32-x64\deno.exe check --config .\supabase\functions\job-materials\deno.json .\supabase\functions\job-materials\index.ts
.\node_modules\@deno\win32-x64\deno.exe test --config .\supabase\functions\job-materials\deno.json .\supabase\functions\job-materials\runtime.test.ts
```

The database suite executes actual migrations against PostgreSQL/PGlite with
test-only Auth/Vault fixtures. It does not prove Vault encryption or gateway JWT
behavior. Native tests require a fresh disposable loopback PostgreSQL 17 database
named `hq_phase1_test`. The harness rejects other hosts/database names.

```powershell
$env:HQ_NATIVE_TEST_URL = 'postgresql://hq_local@127.0.0.1:55439/hq_phase1_test'
npm.cmd run test:database
npm.cmd run test:native
node .\test\database\restart-check.mjs prepare
# Or use `prepare-update` instead to check an uncertain quantity increase.
# Stop/restart ONLY the disposable local PostgreSQL instance between these steps.
node .\test\database\restart-check.mjs verify
Remove-Item Env:HQ_NATIVE_TEST_URL
```

Run the first native command once against an empty database; it installs fixture
schemas and migrations. Subsequent native contention/restart checks reuse them.
Fixtures reset the dedicated test database's data; never use cloud/shared data.

## Full local Supabase gate — completed

The isolated stack was tested on October 11, 2026. See the results report for
exact isolation, exclusions, corrected configuration, and reproduction commands.
These are generic local commands; use the isolated working directory described
in the report rather than the backend's existing hosted link:

```powershell
Set-Location C:\Users\kenne\HQ-Bubble-Build\integration\add-to-job
supabase start
supabase db reset --local
supabase test db
supabase functions serve job-materials --env-file supabase/.env.local
```

Copy `.env.example` to ignored `.env.local` with approved local origins. Runtime
Supabase server keys must stay out of source/client storage/logs. The pgTAP test
checks native Vault encryption/decryption with a fake secret inside rollback.

Administratively create two fake Auth users and isolated HQ fixture accounts.
Test actual issued/expired/invalid sessions, disabled users, revoked memberships,
viewer denial, tenant Data API RLS, CORS and private-secret denial through the
Edge gateway. Keep HCP gates off: lookup must return LIVE_REQUESTS_DISABLED.
Validate Auth signing-key compatibility with `verify_jwt=true`; retain handler
`getUser()` validation. Verify CLI bundling of relative shared `src` imports.
These are required before claiming full Supabase deployment readiness.

## Deployment sequence — separate approval required

1. Pass the complete local gate; pin approved CLI/runtime versions. Review
   account-wide stock visibility and account serialization throughput.
2. Provision approved staging; configure HTTPS origins, Auth invitations/email/
   redirects, backups, recovery, retention and monitoring. Keep anonymous and
   self-service signup disabled until tenant onboarding exists.
3. Review migration history/diff; apply three ordered migrations to staging.
   Verify actual Vault/grants/RLS; do not expose `hq_private` through the Data API.
4. Create HQ account, Auth profiles, server-assigned memberships, inactive HCP
   connection, catalog/costs and technician van/stock through controlled admin
   operations. LocalStorage/PIN data is not automatically trusted or imported.
5. After credential approval, create the real HCP secret using the Vault dashboard.
   Register only its UUID/account ownership in `hq_private.credential_secrets`.
   Never put a key in SQL history, migrations, logs, HTTP responses or the APK.
   Verify the key's HCP company through separately approved read-only requests.
   Server-only `configure_connection` then binds its UUID with `companyVerified:true`.
   That assertion is an operator trust boundary, not an automatic key-validation
   feature. Only controlled server/admin code may invoke it.
6. Deploy with exact origins and runtime server secrets; HCP gates stay off.
   Configure redacted logs, pending/unknown alerts, rate limits and restore tests.
   Scheduled reconciliation workers/alerts and onboarding/admin UI are not supplied.
7. Phase 2 separately connects Supabase Auth and this API to the existing HQ
   interface, preserving scanner/navigation/bubble. Only publishable keys may
   be public; service-role/HCP credentials remain server-side.

Later approved CLI steps include `supabase link --project-ref <approved-ref>`,
`supabase db push --dry-run`, reviewed `supabase db push` and
`supabase functions deploy job-materials`. None was executed. Check current CLI
semantics before targeting hosted data. Never run reset/test fixtures on cloud.

## One real HCP test job: remaining requirements

- Explicit approvals for staging provisioning/deployment, credential storage,
  read-only company/job verification, and writing one designated test job.
- Eligible HCP API key, verified company ID, exact editable test job ID/number,
  and confirmation there is no real customer/invoice impact.
- Authenticated technician, account membership, one verified connection, approved
  catalog SKU/price/cost/taxability and assigned van stock.
- Reviewed job-ID-allowlisted read/write gate change. Discovery scans at most
  five pages and fails closed beyond that bound; validate lookup with actual
  approved company data before enabling it.
- Phase 2 UI/Auth wiring or an approved authenticated API client. Confirm job,
  selected material, quantity and billable pricing before POST.
- Record baseline stock/job lines, submit once, read back the exact line, verify
  all fields and one debit/ledger entry. Replay the key and prove no second line.
  Lost-response tests require their own approved safe scenario.
- Confirm invoice/tax effects and cleanup separately. This creates a billable
  material line, not a job-cost input. No automatic HCP rollback is implemented;
  unknown outcomes retain stock holds for audited operator reconciliation.

Official references: [Vault](https://supabase.com/docs/guides/database/vault),
[Edge auth](https://supabase.com/docs/guides/functions/auth),
[dependencies](https://supabase.com/docs/guides/functions/dependencies), and
[HCP line items](https://docs.housecallpro.com/docs/housecall-public-api/99ba8250597cd-add-a-line-item-to-a-job).
