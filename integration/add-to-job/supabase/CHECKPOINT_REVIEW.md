# Proposed Phase 1 checkpoint — awaiting file-list approval

Branch `bubble-add`, base HEAD `0b6aa149e1fbd03c81a2fc4f62a1c2602523030d`.
**75 exact files**: [PHASE1_CHECKPOINT_FILES.txt](PHASE1_CHECKPOINT_FILES.txt).
Proposed message: `Prepare Phase 1 Supabase backend and verified baseline recovery`.
No staging, commit, push or merge performed. Approval of this list authorizes
one local checkpoint only; deployments/configuration need separate approval.

## Included source and review

- `.gitignore` excludes tooling, runtime/env credentials, exports, logs, database
  files, encrypted/private backups and private key material. `.env.example` is
  allowlisted and contains only the public production origin, no credentials.
- `.gitattributes` preserves exact integration file bytes. This workspace has
  core.autocrlf=true; without this rule Git would normalize tested CRLF migration
  and runtime bytes on staging and invalidate the reviewed hash evidence.
- Backend sources include shared material workflow, gated HCP transport/adapter,
  tenant Auth handler, PostgreSQL RPC/inventory store and durable reconciliation.
  SQLite remains test/mock persistence; Edge code uses PostgREST transactions.
- Supabase source includes exactly three HQ migrations, pinned Deno function/lock,
  local configuration, test SQL, guarded capture/restore/metadata helpers and
  four-index recovery correction source. Recovery correction SQL stays outside
  the HQ migration directory and cannot enter the three-file deployment set.
- Tests cover backend/security/CORS, migration rollback atomicity, database RPC,
  explicit native/local Supabase integration and mock recovery/restart workflows.
  Added test:phase1 selects the self-contained 83-test checkpoint regression.
- Documentation covers schema, captured official HCP contracts, historical
  integration/recovery results, final Auth/CORS plan and portable backup custody.
  Historical reports are retained, with the latest checklist as current authority.

The full tracked diff was reviewed, including Android changes. All tracked
changes other than `.gitignore` belong to the earlier Android/mock UI work and
are excluded. All intended untracked backend files are explicitly listed;
no broad `git add .` or directory staging is proposed.

## Excluded work and private artifacts

Exclude every `app/` change, root README.md/ACCEPTANCE_TESTS.md edits, root bubble
verification reports, integration frontend/, in-app/ (including captured HTML),
local/ prototypes, and their in-app/local/quantity UI tests. These stay untouched.

Exclude `.tooling/` entirely: baseline SQL/ZIP/DPAPI, metadata inventories,
original 30/33 and corrected 45/45 private evidence, local runtime keys/status,
logs, binaries and dependency caches. Also exclude actual `.env*` and Supabase
`.temp`/`.branches`; never stage encrypted backup files either. Ignoring a file
does not protect a previously tracked file; the tracked-private-file audit is
therefore checked separately. No backup/evidence deletion or rewrite occurred.

## Sanitized scan and validation

The Git-visible text scan covers tracked and nonignored untracked files, plus
all-refs historical patches (121,969-byte patch input, lockfiles excluded from
historical patch scan but included in current-file scan). Rules check cloud/PAT
token forms, JWT literals, private keys, credential URIs, secret assignments,
SQL export markers and private filenames. An in-memory cross-check against five
existing local credential values from three env/status files found no matches.
No stored cloud credential was retrieved or displayed for the scan.

Three findings are synthetic local signup-denial passwords and a fixed UUID
identifying a mock secret. These are test fixtures, not hosted credentials.
No actual credential or private export found in the proposed source or scanned
history. One binary Git-visible file is the pre-existing Gradle wrapper JAR,
outside this checkpoint; no new binary is included. Scanner diagnostics contain
only path, line and rule, never matched content. This is a pattern/custody audit,
not a proof that arbitrary encoded secrets are impossible.

Tracked private artifacts: zero; staged files: zero. Tooling/runtime inventory
contains 28,488 ignored paths, including the original backup and evidence.
Ignore checks cover existing private artifacts and representative future backup,
credential/log paths while confirming the three migrations remain Git-visible.
The final local mock/security/embedded database suite passed **83/83**;
`git diff --check` passed. No native/hosted/recovery database was modified by this run.

The three migration SHA256 values exactly match prior locally tested/reviewed
evidence: [MIGRATION_SOURCE_SHA256.json](MIGRATION_SOURCE_SHA256.json).
Runtime bytes match the prior passing CORS revision manifest. An ignored
`checkpoint-source-seal.json` pins all 75 proposed working files and base HEAD.
Before the approved commit, compare each staged blob to this seal, check the exact
index list, re-scan staged contents and review the staged diff. Stop if any file
or source hash changes; a checkpoint commit SHA does not exist yet.

Current recommendation and all remaining gates:
[DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md). Age is not installed and no
portable/off-site copy or independent-machine decrypt test has been executed.
