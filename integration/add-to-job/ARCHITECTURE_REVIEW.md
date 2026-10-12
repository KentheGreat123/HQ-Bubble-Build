# Add to Job backend: architecture and deployment review

Historical pre-Supabase design review. Current implementation and readiness gates
are in [supabase/DEPLOYMENT_CHECKLIST.md](supabase/DEPLOYMENT_CHECKLIST.md);
older absent-component statements below do not describe the final checkpoint.

Reviewed October 11, 2026 on `bubble-add`. This work changes only the local `integration/add-to-job` module. Earlier Android edits remain intact. No branch switch, commit, merge, push, deployment, production website modification, or live Housecall Pro request was performed.

## Deployment decision

**The architecture is ready for review and mocked integration. The backend is not ready for production deployment.** Account authentication, production policies, catalog/inventory implementations, hosting and operational reconciliation are still absent. Passing mocks do not prove these external systems work.

## Ownership and extension boundary

`MaterialService` is the shared workflow. It resolves/authorizes selected jobs, validates selected SKU and quantity, prepares server-owned pricing for technician confirmation, revalidates selections, durably claims submissions, reserves inventory, submits a material, records its external ID, commits inventory and reports status. It has no HCP wire fields, endpoints or credentials.

`JobMaterialsRegistry` selects an adapter from a server-owned account connection. `job-materials-contract.d.ts` defines the normalized job/material and inventory ports. Adding a future platform requires a server factory implementing job lookup, external-account verification, authentication, material posting and response mapping. The material operation means a priced, billable job material, not a cost-input-only operation. An adapter must preserve that meaning or reject an unsupported operation.

`HousecallProJobMaterialsAdapter` implements that contract using the unchanged `HcpClient` and `createLiveTransport`. HCP pagination, internal job IDs, company checks, numeric display-number rules, `kind: materials`, cents fields, pricebook fields and response validation stay within the HCP implementation. The official API requirements remain in REQUIREMENTS.md. ServiceTitan has no adapter, API client, credential flow or network calls; an unregistered platform fails closed.

This contract currently uses integer cents and quantities with at most two decimals. Future platforms must validate compatible currency/precision and tax semantics before registration; multi-currency, discounts, tax overrides, batch material submission and platform job-segment selection are not implemented.

## Account isolation and permissions

- `account_connections.account_id` is the primary key: an HQ account has zero or one selected platform connection. Trusted provisioning replaces that row atomically and advances a version.
- Connection selection comes from the authenticated principal's HQ `accountId`, never a browser platform, external company, URL or credential. Account identity is distinct from the HCP company ID.
- Connection changes invalidate old confirmations/quotes. A transaction checks the connection ID/version while claiming a submission, closing the race where provisioning changes during a catalog lookup.
- Unfinished submissions block connection replacement. This keeps inventory holds and unresolved material outcomes attached to their original connection. Legacy unresolved rows without account metadata conservatively block provisioning until reviewed.
- The adapter verifies HCP's returned `company_id` against the connection's external account. The catalog must return the authenticated HQ `accountId`. Durable request keys are account/connection/version-scoped and owner-bound; another technician cannot read/replay that request.
- Required server policy callbacks authorize `jobs:read`, `materials:create`, `materials:read` and `materials:recover`; `authorizeJob` separately checks assigned/allowed jobs. Write permission is checked again after inventory reservation. Recovery is currently restricted to the original submitting technician plus recovery permission. An audited administrator recovery/history API is still required.
- `store.connect` is an internal provisioning port, not a public endpoint. Production onboarding must authenticate an administrator, verify external-account ownership and bind the connection ID/version to its secret-manager credential. A database row alone does not prove ownership. These provisioning and identity implementations are not supplied.
- Factories must create account-bound adapters/transports and secret providers. Never reuse a global tenant credential or trust localStorage/PIN roles. CORS is not authorization. Existing mock fixtures are deliberately not production authentication.

## Pricing and confirmation

The authoritative account catalog owns SKU/name, selling price, company cost, taxability and optional opaque platform reference. Client price/cost/type/platform/job-ID overrides are rejected. The shared workflow stores a five-minute quote and returns its selling price, quantity and taxability for explicit UI confirmation; internal cost/reference remain out of that quote response. Submission re-reads the catalog and refuses changes to the confirmed selection/pricing. A new quote is required after a change. Job confirmations expire after ten minutes.

The current material submission result contains the normalized material price/cost data, as the previous backend did. Production role-based response policy must decide which technician roles may see company cost. The quote is not a platform-calculated final invoice/tax total. HCP remains responsible for platform invoice calculation.

## Durable idempotency and inventory recovery

SQLite uses WAL and FULL synchronous mode. A unique claim commits before any reservation/material mutation. Payload, job ID, account, owner, reservation ID, submission state and confirmed external material result are retained. Existing submission tables are migrated additively; legacy records are preserved. Use a protected persistent database, never `:memory:`, for real submissions.

| Stage/outcome | Behavior |
| --- | --- |
| Claim acquired | Persist request identity and normalized server-priced payload before external mutations |
| Inventory reserved | Persist reservation ID before material submission |
| Reservation throws/times out | No material POST; retain unresolved claim for inventory reconciliation; no automatic reserve retry |
| HCP request fails/times out or response is invalid | Retain reservation and unresolved claim; no automatic POST or stock decrement/release |
| HCP confirms material | Persist external material ID/result before committing inventory |
| Inventory commit fails | Return `inventory_pending` / HTTP 202; replay returns pending without another POST |
| Recovery of recorded material success | Retry only inventory commit with the same account-scoped operation ID; then persist `confirmed` |
| Crash before confirmed remote result is persisted | Require operator reconciliation; do not infer remote absence or post again |
| Inventory commit succeeded but final database update failed | Recovery repeats the same idempotent inventory commit, not a material POST |

The inventory port must implement durable, atomic stock reservation and idempotent commit by account/operation ID. Concurrent recovery calls may invoke commit more than once; inventory must deduplicate those calls. No production inventory implementation is provided, so actual stock correctness is not yet established.

There is no distributed transaction or exactly-once guarantee across SQLite, inventory and HCP. A crash after remote creation but before local recording remains ambiguous. Automated compensation is deliberately absent: an operator must establish whether a material exists and whether inventory is reserved/committed before recording reconciliation or releasing stock. Do not release on a timeout, auto-delete a customer line, or generate a new key to bypass an unknown outcome. Administrative reconciliation, reservation release, stuck-operation monitoring, audit trail and cross-connection submission history are incomplete deployment blockers.

## Shared HQ API flow (not deployed)

1. `POST /api/hq/jobs/resolve` with `{jobNumber}`: resolve an authorized internal job and return `confirmationId` plus customer/job details.
2. `POST /api/hq/materials/prepare` with `{confirmationId, sku, quantity}`: return a server-priced `quoteId` and displayable selection for user confirmation.
3. After explicit confirmation, `POST /api/hq/materials` with `{confirmationId, quoteId, sku, quantity, idempotencyKey}`. Save this command and its key before submission. HTTP 201 / `confirmed` means material and inventory have completed; HTTP 202 / `inventory_pending` means material exists but inventory still needs completion.
4. `POST /api/hq/materials/status` with `{idempotencyKey}` reads durable status without remote requests. `submission_pending` or `reconciliation_required` must not be displayed as success. Retry an unchanged command only with its original key.
5. `POST /api/hq/materials/recover` with `{idempotencyKey}` requires recovery permission and a recorded successful material result. It completes inventory only. Unknown remote outcomes require the separate operator workflow still to be built.

The public website has not been updated to these routes or to show pricing confirmation/status. Its existing Add to Job behavior remains simulated/local. Frontend part/job selection must be wired to this shared workflow only after approval; no HCP-specific calls or credentials belong in the web bundle or APK.

## Required before deployment

1. Implement real server identity validation, account membership/role policies, job authorization, administrator connection provisioning and account-bound managed secrets. Confirm HCP API entitlement and response/rate-limit behavior.
2. Supply an authoritative account catalog with pricing/tax policy and a durable inventory coordinator. Test stock contention, deduplication, reservation persistence, commit and verified release using that real inventory system.
3. Choose/pin hosting and a supported persistent database. Node 24.14.0 currently warns that built-in SQLite is experimental. Evaluate that runtime/database choice; implement backups, restore drills, data protection, retention and safe migration procedures. Multi-instance hosting must share a transactional store, not independent local database files.
4. Implement audited operator reconciliation, stock-release procedures, stuck-operation alerts and administrator/history access. Test crash windows between every remote call and durable update. No automated retry may duplicate an uncertain material.
5. Add HTTPS/gateway controls, rate limiting, restricted CORS, cookie CSRF protection where applicable, secure logging and monitoring. The module has no public listener or deployment configuration.
6. With separate approval, wire the production frontend's existing part-selection paths to job resolution, price confirmation and honest submission states. Service-worker/offline queuing behavior is not implemented or validated here.
7. Only with explicit approval, enable requests for a designated HCP test job. Verify a single material, quantity, cents, tax, billable total, preserved existing lines, stock commit and same-key replay. This has not been done. ServiceTitan implementation and testing remain future work.

## Verification

October 11, 2026:

- 25 existing backend integration tests passed, updated to exercise the required quote/adapter architecture.
- 18 new architecture tests passed: vendor-independent execution, single connection, unsupported ServiceTitan, stale connection/claim race, account and job isolation, permissions, catalog ownership/price changes, quote expiry, account-wide keys, inventory uncertainty, partial completion/recovery, restart durability, additive legacy migration, status isolation and preserved HCP pricebook mapping.
- 4 existing WebView bridge contract tests passed.
- Android `test` / `lintDebug` passed; then `testDebugUnitTest lintDebug --rerun-tasks` passed with all 35 tasks executed in 33 seconds. All 15 Android unit tests passed, zero failures/errors/skips. Lint had zero errors and 22 existing warnings.
- Node syntax checks for all backend/test `.mjs` modules passed; tracked Git diff whitespace checks passed.

Total: **62 automated tests passed** (43 backend + 4 bridge + 15 Android). No live API, deployed backend, real inventory transaction, production frontend or physical-device Add to Job test is claimed. No new APK was produced by this backend-only task.
