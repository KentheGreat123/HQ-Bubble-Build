# Phase 1 local Supabase results — October 11, 2026

**Local integration gate: PASS. Hosted deployment: NO-GO pending the remaining gates below.**

Work remained on `bubble-add`. No hosted Supabase requests/changes, live HCP API
calls, production HQ changes, Android source changes, commits, pushes, merges,
or branch switches occurred. Existing unrelated working-tree changes were preserved.

## Isolation and runtime

Docker Desktop 4.94.0 / Linux engine 29.8.2 connectivity passed. Supabase CLI
2.120.0 used project ID `firstrate-hq-local` in the unlinked directory
`.tooling/phase1-supabase-local`. Existing hosted-link metadata was preserved and
never used for database commands. Test HTTP traffic was restricted to loopback:
API `127.0.0.1:54321`, PostgreSQL `127.0.0.1:54322`.

The initial image pull stalled on shared containerd layer locks. Stopping only
the stalled CLI/pull process and pulling the remaining Edge image sequentially
resolved it. PostgreSQL, Auth, PostgREST, Kong, and Edge runtime were tested.
Ancillary Studio, realtime, storage, analytics, mail, and metadata services were
excluded to fit Docker's approximately 4 GB allocation; they were outside this scope.

Database: PostgreSQL 17.11 with native Vault. Edge runtime: 1.77.4, compatible
with Deno 2.1.4. Host tools: Node 24.14.0 and Deno 2.9.6. The function served
with `verify_jwt=true`, resolving its shared relative imports and pinned SDK.

## Fixes found by real execution

1. Migration 1's blanket Vault function revoke failed with SQLSTATE 42501 on
   `_crypto_aead_det_encrypt`. Those internal crypto functions belong to
   `supabase_admin`, already deny client execution, and cannot be administered by
   `postgres`. The migration now revokes only functions with effective client
   access. Its exhaustive final assertion still rejects any remaining client
   privileges. No crypto privileges were granted. The failed atomic migration
   published zero public HQ objects. All three corrected migrations then passed
   a fresh `db reset --local`: `202610110001`, `202610110002`, `202610110003`.
   All 16 HQ tables enforce and force RLS.
2. The installed CLI maps `[auth.email].enable_signup=false` to disabling the email
   provider, blocking existing-user logins. This local flag is now true while
   global `[auth].enable_signup=false` remains false. Actual password login and
   refresh pass; self-service signup remains rejected.

These backend changes are local and undeployed. The previous hosted dry-run
predates the corrected migration and does not validate this exact revision.

## Verification

| Suite | Result |
| --- | --- |
| Backend, controllers, local lab, migration atomicity, quantity dialog, bridge | 71/71 passed |
| Embedded PostgreSQL regression, after the fix | 36/36 passed |
| Native PostgreSQL regression in separate `hq_phase1_test` database | 36/36 passed |
| Native multi-session contention | 5/5 passed |
| Real Supabase Auth/Data API/Vault/gateway/RPC integration | 12/12 passed |
| Native pgTAP security/Vault checks | 9/9 passed |
| Deno runtime | 2/2 passed; entrypoint type check passed |
| Android shared unit tests, fresh execution | 17/17 passed |
| Debug and mock lint | Passed; each has 0 errors, 27 warnings |
| Real database restart durability probes | Passed |

Total: 188 passing test executions, including the same 36 SQL cases on two
database runtimes. This project has no separate `testMockUnitTest` task; shared
tests run under `testDebugUnitTest`. No device installation or physical/visual
phone verification was performed. `git diff --check` passed.

## Real security and transaction evidence

Four fake Auth users exercised actual password sessions, refresh tokens,
`getUser` validation, bad passwords, and blocked signup. The tested local signing
mode was HS256. The gateway/handler rejected correctly signed expired JWTs,
malformed JWTs, invalid signatures, and anonymous API tokens. Valid sessions
reached the actual function and received `LIVE_REQUESTS_DISABLED`. Exact-origin
CORS, foreign tenant selection, revoked memberships, and disabled HQ profiles
were denied.

Authenticated Data API requests proved account/catalog/inventory tenant isolation.
Clients could not elevate membership roles, invoke the server RPC with a forged
actor, or expose private/Vault schemas. SQL checks denied plaintext to both anon
and authenticated roles. Native Vault stored a fake secret as ciphertext, decrypted
it server-side, and preserved it across a database-container restart.

Business flows exercised the shared production handler with real Auth and real
PostgREST transaction RPCs, injecting only an in-process HCP mock. The harness
rejects HTTP fetches outside loopback. The deployed local entrypoint retained its
hard-disabled HCP transport; no production mock switch or gate change was added.

- Eight concurrent create requests produced one mock POST/material/stock debit.
  Eight concurrent update requests produced one PUT and preserved the line ID.
  Quantity 2 → 3 debited only the additional 1; stock 10 → 8 → 7, with two ledger
  entries. Replay produced no additional debit.
- Updates required explicit confirmation. Changed reviewed quantity,
  description-only identities, and multiple pricebook matches failed closed.
  Invalid quantities and competing stock claims could not oversell.
- Lost POST/PUT responses retained holds and never resent the write. Authorized
  administrator read-back reconciliation committed inventory once, including replay.
- A failing ledger trigger rolled back stock and confirmation atomically.
  Inventory-only recovery succeeded after its removal with no second POST.
- Failed update read-back retained verification/stock state; recovery succeeded
  after the mock read recovered, without another PUT.
- A real database restart preserved the separate native database's uncertain
  update: on-hand 8, reserved 1, one prior ledger entry, and durable dispatch intent.
  Replay stayed blocked; recovery made zero remote requests. Four actual Auth
  users, native encrypted Vault data, and three migrations also persisted.

## Reproduction and retained state

Runtime credentials are in ignored local `status.json`, not repository source.
Startup logs were scrubbed of CLI credential status records. Passing logs under
`.tooling/phase1-supabase-local` include `regression.log`, `native-database.log`,
`native-contention.log`, `real-supabase.log`, `pgtap.log`, and reset/function logs.

With this isolated stack running and its local `status.json` present:

```powershell
Set-Location C:\Users\kenne\HQ-Bubble-Build\integration\add-to-job
$env:HQ_SUPABASE_LOCAL_TEST = '1'
npm.cmd run test:supabase:local
Remove-Item Env:HQ_SUPABASE_LOCAL_TEST
```

This intentionally resets the disposable stack's HQ fixtures. Never use it for
shared local data. Explicit opt-in and API/DB host/port checks reject hosted targets.
Native regression fixtures use the separate localhost `hq_phase1_test` database.

The local stack and function-serving process remain running for inspection. Data
is fake; the separate native database intentionally retains its uncertain-update
fixture. Stop only this stack, preserving its local data, with:

```powershell
Set-Location C:\Users\kenne\HQ-Bubble-Build
.\.tooling\supabase\supabase.exe stop --workdir .tooling/phase1-supabase-local
```

## Remaining deployment gates

**NO-GO for hosted Phase 1 deployment today. The local execution blocker is cleared.**

1. **Cleared:** corrected migration review and guarded hosted dry-run passed;
   the user reported exactly the three expected files in order. See
   [HOSTED_PREDEPLOY_REVIEW.md](HOSTED_PREDEPLOY_REVIEW.md) for provenance and
   unchanged file hashes. No migrations were applied by that dry-run.
2. Verify target backup/restore and rollback procedures, including Vault key/secret
   recovery. Local restart durability is not a backup restore or hosted recovery test.
3. Verify target Auth signing-key mode/gateway compatibility, invitation/login
   policy, exact HTTPS origins, runtime secrets, grants, and monitoring. Local HS256
   success does not prove a hosted asymmetric signing configuration.

After those gates pass and deployment is approved, this implementation is suitable
for controlled Phase 1 staging deployment with HCP reads/writes still off. Live
HCP activation, a designated real test job, Phase 2 UI/Auth integration, and
production rollout remain separate work. Automated reconciliation workers/alerts
and onboarding/admin UI are not supplied.

Official references: [local development](https://supabase.com/docs/guides/local-development/cli/getting-started)
and [Edge authentication](https://supabase.com/docs/guides/functions/auth).
