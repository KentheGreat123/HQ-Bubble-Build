# Baseline recovery and CORS revision — October 11, 2026

Latest result: [ISOLATED_RESTORE_RESULTS.md](ISOLATED_RESTORE_RESULTS.md). Capture
and encrypted package integrity now pass. The first import rolled back, and the
separately approved existing-local-admin retry imported successfully. Full
verification remains FAIL (30/33 checks); the retry is consumed. Earlier pending
execution/approval statements below are history.

Project `ixtnmcrtgcyojqrthbhw`; branch `bubble-add`.

**NO-GO for hosted deployment. Backup capture/restore execution is pending the
operator's guarded terminal command, not a completed recovery test.**

## Completed local work

- Added `x-client-info` to the shared handler's SDK preflight headers.
- The deployment entrypoint accepts only `https://kenthegreat123.github.io`
  from `HQ_ALLOWED_ORIGINS`. Unset configuration denies browser origins; additional
  configured origins cannot widen the production-only policy. POST/OPTIONS,
  exact-origin matching, bearer verification, and tenant checks remain required.
- HCP reads/writes remain hard-disabled in the entrypoint. No cloud settings,
  credentials, migrations, functions, production HQ, or Android files were changed
  by this work. Existing unrelated workspace changes were preserved.
- Auth draft finalized for disabled public/anonymous signup, enabled email login,
  confirmation required, production-only origin, and pending callback/testing URLs.
  Invites remain pending an implemented HTTPS callback and approved SMTP delivery.
- All three migration hashes still match the successful local-test/dry-run revision.
  Two production runtime files and one Edge test file intentionally changed. The
  old 17-file manifest remains historical evidence; the revised hashes are recorded
  in ignored `.tooling/phase1-hosted-review/cors-revision-manifest.json`.

## Validation

- Backend, bridge, controllers, mock workflows, migration atomicity and CORS:
  73 tests (71 existing plus 2 CORS checks); see private `cors-regression.log`
  (69 backend tests) and `cors-bridge.log` (4 bridge tests). The bridge suite
  requires the repository root as its working directory and was run there.
- Embedded PostgreSQL security, RLS, Vault privilege substitutes, transaction
  workflows, contention and uncertain-response recovery: 36 tests; see
  `cors-database.log`. These substitutes do not prove native Vault encryption.
- Three Edge tests passed in actual Deno via a sequential in-process adapter;
  the normal Windows runner's named pipe is unavailable in the sandbox. The
  adapter invokes the same registered test functions, without bypassing assertions.
- Changed entrypoint passed Deno type checking with the pinned cached SDK.
- Backup/restore scripts parsed successfully. Inventory SQL executed successfully
  against the existing local Supabase PostgreSQL in a read-only transaction.
  No test-fixture reset, schema apply, or write was performed on that database.
- Native Supabase Auth/Vault/JWT/gateway and pgTAP results from the previous
  revision remain recorded in `LOCAL_SUPABASE_RESULTS.md`. They were not rerun
  against the existing test database because this request prohibits overwriting it.

## Capture and restore status

The existing hosted database password is unavailable to the agent. The user chose
to run the guarded capture script in their terminal. Docker read access outside
the sandbox was rejected; no Docker workaround or existing-stack reset was used.

Run the already approved capture/new-target preparation:

```powershell
& 'C:\Users\kenne\HQ-Bubble-Build\integration\add-to-job\supabase\Capture-HostedBaseline.ps1' -StartIsolatedTarget
```

The script checks the fixed project, branch and CLI hash, prompts for the existing
password, compares pre/post read-only inventories, and fails rather than creating
a login role. It exports roles, schema, data, explicit Vault data, and managed
Auth/Vault schema references. Plaintext files are restricted locally to the
Windows user and SYSTEM. A Windows-user-bound DPAPI archive is created; that copy
alone is not portable recovery or off-site custody. No root key is read.

`Prepare-IsolatedRestore.ps1` refuses an existing workspace or occupied ports and
starts an unlinked `firstrate-hq-restore-rehearsal` on DB 55452/API 55451. It has
no HQ migrations/functions, outbound email service, or reset operation.

After successful capture/start, restore using the reported private folder path:

```powershell
& 'C:\Users\kenne\HQ-Bubble-Build\integration\add-to-job\supabase\Restore-HostedBaseline.ps1' `
  -BackupDirectory '<reported absolute backup folder>'
```

The restore verifies checksums and DPAPI round-trip, requires the exact local
target and an empty baseline, checks managed Auth/Vault definitions/version,
then imports reviewed files in one transaction with ON_ERROR_STOP. It records
row-count, owners/ACL/RLS, defaults/constraints/indexes/triggers, function privilege,
application-role membership, policy, default-privilege and schema checks. It stops on differences instead of
applying blanket grants, suppressing errors, or automatically replaying a restore.
The empty Vault import is explicitly skipped only after proving zero secrets.

**A partial backup folder has been observed, but no completed capture, running
restore target, imported baseline or restore PASS.** Operator output and private artifacts must be
verified before updating this status. Nonempty Auth login recovery and encrypted
Vault recovery cannot be proven from the current empty hosted baseline. Future
Vault import/root-key portability remains a separate gate before real credentials.

### Native stderr correction and incomplete capture

The first terminal capture stopped on PowerShell's `NativeCommandError` for
`Dumping roles from remote database...`, before an exit-code check. This is a
PowerShell stderr-handling failure; the underlying CLI outcome was not recorded.
It is not evidence of a successful export or a diagnosed CLI/database failure.

`Invoke-GuardedNative.ps1` now drains stdout/stderr privately through .NET process
streams. Every export checks its explicit process exit code and requires a
nonempty output file. Only fixed sanitized diagnostics are displayed. Existing
project, password, read-only, ACL, encryption and before/after checks remain.
The isolated-start/status steps use the same handler to avoid repeating the bug;
local credential-bearing status JSON is captured privately in a restricted folder.
Synthetic local process tests passed for progress stderr, failure exit codes,
sanitized errors, opt-in output capture and Windows argument quoting. The actual
password-protected backup was not run by the agent.

The partial directory `20261012T015653Z` contains a 71,403-byte inventory and a
zero-byte `roles.sql`. No manifest, encrypted archive or completion marker exists.
Its restricted ACL and contents were preserved; metadata/hashes were recorded in
ignored `.tooling/phase1-hosted-review/partial-backup-inventory.json`. No private
contents were printed. The retry creates a distinct millisecond-stamped folder
and refuses reuse. Restore now requires `capture-complete.json` as well as the
manifest, checksums and encrypted round-trip; this partial capture is ineligible.

Retry from PowerShell (process-scoped execution-policy flag; no system policy change):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\kenne\HQ-Bubble-Build\integration\add-to-job\supabase\Capture-HostedBaseline.ps1" -StartIsolatedTarget
```

This performs the approved capture and prepares the isolated target after success;
it does not import the backup or deploy anything. Restore remains a separate
guarded step once the capture is verified. The logical roles/schema/data import
sequence follows the [Supabase restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

### Metadata curl exit 2: diagnosed and corrected

The subsequent terminal retry failed before any export, leaving only an incomplete
capture-status file in `20261012T020745808Z`. All incomplete folders were accounted
for in ignored `incomplete-captures.json`; no contents or ACLs were changed.

Local reproduction using the full SQL/configuration and a synthetic token proved
that a Windows PowerShell 5.1 UTF-8 console encoding with a three-byte preamble
causes the default process stdin writer to emit a BOM. Curl treats the BOM as part
of the first option name, returns 2, and produces no HTTP result. A normal OEM
console did not reproduce it. Direct BaseStream writes alone did not fix it because
the process auto-flushing writer can emit its preamble during initialization.
The explicit Windows PowerShell retry can expose this preexisting encoding bug;
the stderr correction did not change the API URL or request data.

`Curl-ConfigTransport.ps1` now creates a UTF-8 stdin writer without a BOM. On .NET
Framework, it temporarily selects that encoding during process creation and
immediately restores the caller's encoding. Newer .NET uses StandardInputEncoding.
An assertion rejects a non-UTF-8/BOM-bearing writer before writing credentials.
The config remains stdin-only, with a fixed HTTPS project endpoint, POST JSON,
Content-Type and Bearer headers, and read_only=true. Token-format validation rejects
control-character/configuration injection. Windows System32 curl is selected
explicitly; --disable prevents uncontrolled curlrc settings or tracing.
Curl's config/argument rules are documented in the
[curl manual](https://curl.se/docs/manpage.html).

Validation:

- Existing Windows CLI credential found and format valid; only booleans displayed.
- No-network tests parsed the complete real SQL/config with a synthetic token in
  both UTF-8 host modes, verified zero BOM and restored host encoding, and rejected
  token injection. Native stderr/exit-code regression tests still passed.
- An unauthenticated HEAD reached the exact HTTPS endpoint with HTTP 401 and
  curl exit 0, without disabling TLS verification or sending credentials.
- The corrected authenticated metadata SELECT succeeded with curl exit 0 and
  HTTP 201. The success check accepts 2xx plus valid JSON; the result verifies
  read_only=on, PostgreSQL 17.11, zero Auth/Vault/HQ objects, and no HQ history.
  Private evidence is `curl-fixed-inventory.json`; no response body was printed.
  The sandbox's blocked proxy required approved read-only checks outside it.

No password-protected backup, cloud change, deployment, password reset or new
credential was performed. The guarded backup retry command above is unchanged.

## Exact remaining requirements

1. Complete guarded capture and isolated restore; review all results and any
   managed platform differences. Verify a portable encrypted off-site copy and
   recovery ownership. No required Supabase plan upgrade or PITR purchase.
2. Establish a reviewed rollback procedure for this exact baseline and preserve
   migration history consistency. Do not treat a successful dump as recovery proof.
3. Obtain separate approval to apply invite-only hosted Auth settings and the
   production-only runtime origin. No Auth/settings/secrets changes are authorized
   by this backup/CORS approval.
4. Refresh reviewed revision hashes/source metadata and the guarded three-migration
   dry-run before separately approved database deployment. The old full-runtime
   dry-run guard intentionally rejects the changed CORS revision until updated.
5. Separately approve the Edge deployment. Keep JWT verification and HCP gates
   closed; verify hosted ES256 sessions, client/RLS denials, SDK preflight, and
   LIVE_REQUESTS_DISABLED during acceptance. A fresh isolated gateway run of the
   revised entrypoint can extend the local evidence without touching the old stack.
6. Before staff invitations/frontend activation: implement/approve the exact HTTPS
   callback, approve SMTP/provider costs, and provision reviewed tenant memberships
   through trusted administration. Testing origins remain empty by user choice.

No commit, push, merge, cloud deployment, hosted configuration or live HCP action
has been performed. This status must remain NO-GO while recovery is pending.
