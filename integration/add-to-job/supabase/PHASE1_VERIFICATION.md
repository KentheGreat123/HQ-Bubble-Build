# Phase 1 and duplicate-material verification

Verified locally October 11, 2026, on `bubble-add`. Nothing committed, pushed,
merged, deployed or provisioned. No real HCP credentials or API requests used.
Preexisting uncommitted work was retained. Android Kotlin, bubble and production
HQ code were not edited by this work. The later duplicate-material request
updated only the existing isolated HQ test assets and their shared popup source;
it did not create an additional test application.

## Results

| Check | Result |
| --- | --- |
| Backend/SQLite/mock lab/controller/popup regression suite | 66 passed |
| Embedded PostgreSQL migrations, RLS, roles, transaction/recovery/update suite | 36 passed |
| Native PostgreSQL 17.11 migration/workflow suite | 36 passed |
| Native multi-connection concurrency suite | 5 passed |
| Deno shared Edge runtime tests | 2 passed; entrypoint type check passed |
| Existing HQNative bridge contract | 4 passed |
| Android debug unit tests | 17 passed |
| Android debug and mock lint | Both passed; zero errors, 27 warnings each |
| Existing isolated mock APK build | Passed; signature and manifest verified |
| Actual PostgreSQL stop/start durability | Passed for uncertain creation and quantity update; zero recovery requests |
| Complete Supabase Docker/Auth gateway/native Vault pgTAP | Not run; Docker/Supabase CLI unavailable |
| Real HCP and physical-phone popup/insets | Not tested; live requests disabled |

Embedded and native runs execute the same database test cases and should not be
counted as distinct feature tests. The native contention suite uses independent
database connections; PGlite alone is not proof of multi-session locking. Both
SQL suites use explicit test-only Auth/Vault stand-ins, not real encryption or
issued Supabase sessions. The native Vault pgTAP file remains a deployment gate.

## Three verification passes

1. **Security:** reviewed client grants, forced RLS, composite tenant foreign
   keys, server-only RPC execution, actual database roles/revocation, private
   costs, Vault ownership bindings, exact CORS, bounded requests and sanitized
   responses. Fixed cross-account Vault binding risk with ownership foreign keys
   and NULL-safe company-verification checks. Tests deny forged actor RPC calls,
   anonymous access, direct writes and foreign account/secret reads. Real HCP
   gates are hard-disabled in the deployment entrypoint.
2. **Transactions:** reviewed account/connection/submission/stock lock order,
   durable dispatch intent and remote ID, stock holds, unique ledger debits,
   uncertain recovery and material identity/update locking. Injected ledger
   failure proved complete SQL rollback. Fixed recovery of a crashed dispatching
   row and NULL-sensitive verification. Native contention proves duplicate taps
   and competing update keys cannot both dispatch the same reviewed operation.
   Actual restart preserved unknown state/holds with no repeat POST or PUT.
3. **Architecture:** reviewed Deno compatibility, async persistence, SQLite
   regressions, shared platform contract, HCP-only wire mapping and frontend
   boundaries. Web Crypto/Fetch replace Node-only shared dependencies; the Edge
   entrypoint checks under Deno. ServiceTitan is an interface extension only.
   The popup lives in the existing isolated HQ design and never submits by itself.
   Production Auth/UI wiring, native Vault/gateway and CLI bundling remain gates.

These are three focused verification passes, not a claim of three independent
human reviewers. The complete local Supabase stack was not available.

## Duplicate-material contract and behavior

The official schema was fetched again and matched SHA-256
`16bba973bae069e546529bf9d2afd836b1746ae557dcadb903c6924a7993a495`.
The captured [update contract](../official-update-contract.json) documents
`PUT /jobs/{job_id}/line_items/{id}`, JSON `LineItem`, required `name`, optional
`quantity`/other mutable fields, a 200 `LineItemResponse`, and documented 400/404
responses. Company/application key authentication uses `Authorization: Token ...`.
The export does not document update-specific scopes, conditional revisions,
atomic increments or an idempotency guarantee. Real key/company authorization
must be verified only after separate approval.

Before quoting and before dispatch, GET current job lines. Identify selected
parts using pricebook ID/type or durable HQ SKU-to-line-ID history. Never infer
identity from description/name alone. An unidentified legacy material blocks
automatic absence/uniqueness decisions; map a reliable pricebook reference or
resolve it operationally before proceeding. Multiple reliable matches block
automatic updating. Failed lookup never becomes an empty list.

For one match, the existing HQ test interface shows **Part Already on Job** with
selected part number/description, job number, old quantity, additional quantity
and new total, plus the requested question and **Cancel / Update Quantity**.
Cancellation performs no submission or inventory mutation. The server requires
explicit `confirmQuantityUpdate:true` with the reviewed quote. A changed quantity
or retained property requires fresh review. A final GET immediately precedes PUT.
The update preserves line ID, price, cost, kind, taxes and all recorded retained
properties; GET read-back verifies them and the new total. Only the additional
quantity is reserved/debited. There is no fallback POST, bulk update or delete.

Definitive 400/401/403/404 rejection blocks updating and safely releases its hold.
Timeouts, malformed responses and lost outcomes remain held for reconciliation;
the same request key never increments again. A verified administrator may adopt
the existing line after checking the recorded total/properties and evidence.

**Remaining race:** HCP documents no conditional PUT/If-Match or atomic increment.
Immediate re-read detects prior changes but cannot prevent a direct HCP edit in
the gap before PUT. HQ serializes its own same-part/line operations only. Before
live quantity updates, validate preservation semantics with one approved test
job and agree an operating rule preventing concurrent direct HCP edits, or
obtain a vendor-supported conditional update mechanism. No distributed
exactly-once guarantee is claimed.

## Existing isolated test APK

Path: `C:\Users\kenne\HQ-Bubble-Build\app\build\outputs\apk\mock\app-mock.apk`.
Application: `1st Rate HQ TEST`, package `com.firstrate.hq.mock`, min SDK 26,
target SDK 37, version 3 / `0.2.1-mock`. Production remains `com.firstrate.hq`.
Signature verified with APK v2 and the existing workspace debug certificate:
`e102b04d3b4efdc52b9e431542e521f864eef29e88a941afcb6731432a17febb`.
The keystore access failure was resolved by using the project's documented
`ANDROID_USER_HOME=.tooling/android-home`; no signing key was replaced.
Latest build: **October 11, 2026, 4:09:50 PM America/Chicago (CDT)**;
4,027,468 bytes. SHA-256:
`6b4315d07213b77d846e0f21721e2a4f48b472986011215bd0c9075448f44be9`.
This APK was not installed or tested on a phone during this work.

## Manual testing in the existing HQ test build

Use the existing Wi-Fi backend/pairing instructions in
[in-app README](../in-app/README.md), and only the isolated test APK. Production
HQ still has no Phase 2 authenticated backend wiring. No new browser test page
or separate test app was created for this request.

1. Select or scan an actual displayed part, choose an editable mock job, and add
   quantity 2. Verify one material line and a two-unit stock reduction.
2. Select the same part/job again with quantity 1. Review: popup must show old 2,
   added 1, total 3, and the selected SKU/description/job number.
3. Cancel. Verify unchanged line quantity and stock.
4. Review again and choose Update Quantity. Verify the same line ID now has
   quantity 3, one PUT in evidence, no second POST, and one additional stock debit.
5. Replay the same request. Verify unchanged quantity/stock. Try rapid duplicate
   taps, lost-response and inventory-failure modes without replacing uncertain
   keys; verify clear pending/reconciliation messages and no repeated update.
6. On Samsung, inspect popup at status/gesture/cutout areas, keyboard open,
   rotation and large text. Verify HQ navigation/scanner and HCP bubble switching.
   These physical-device checks remain outstanding.

Permanent backend staging/deployment and one-real-test-job prerequisites are in
[the runbook](README.md). Native Vault/Auth tests, approved credentials/company/job,
Phase 2 Auth/UI wiring and explicit live-test approval are still required.
