# First hosted deployment: backup, Auth, and execution plan

Project `ixtnmcrtgcyojqrthbhw`; branch `bubble-add`; October 11, 2026.
This is the original proposed sequence. For subsequent authorized backup/CORS
work and its current execution status, see
[BASELINE_RECOVERY_RESULTS.md](BASELINE_RECOVERY_RESULTS.md). CORS is now fixed
locally; hosted Auth/callback/SMTP and deployment changes remain unapplied.
Planning only. No backups/data exports, restore targets, credentials/secrets,
hosted settings changes, deployments, HCP calls, production frontend/Android edits,
commits, pushes, or merges were performed by this plan.

**Recommendation: retain Free for the initial rehearsal, use logical backups, and
do not purchase PITR for this first deployment. Deployment remains NO-GO until
the backup is captured/restored and the approved configuration is applied.**

## 1. Confirmed plan, restrictions, and costs

GET organization metadata confirms organization `1st Rate HQ` is on **Free**.
The project still lists zero restore points and PITR off. WAL-G being enabled
does not give this Free project an accessible managed backup entitlement.

| Option | Availability and cost | Recommendation |
| --- | --- | --- |
| Logical export + local isolated Supabase restore | Supported on Free; no added Supabase subscription. Uses local disk, backup storage, operator time, and export bandwidth. | First choice for this initial deployment |
| Another Free project as a manual restore target | Subject to the two-active-project limit and available slots; requires separately approved provisioning. | Optional; local target avoids using a slot |
| Pro daily backups | Starts at $25/organization/month; seven-day retention. One Micro instance is covered by included compute credit; additional projects/compute/usage can cost extra. | Optional operational upgrade; not needed solely for first logical rehearsal |
| Managed Restore to a New Project | Paid plan and source physical backup required. Additional target compute is billed. | Unavailable on current Free plan |
| PITR | Paid plan, at least Small compute, and add-on starting around $100/month, plus plan/compute costs. | Not required for pre-deployment recovery; reconsider only if later recovery-point needs justify it |
| Custom SMTP | Supabase permits it on Free; provider charges depend on service/volume. No provider selected or account created. | Needed before ordinary staff invitation delivery |

Free also has a 500 MB database allowance, two active projects, and inactivity
pausing after a week. A Supabase API custom domain is not needed for HTTPS:
the existing `*.supabase.co` endpoint is HTTPS already. No paid upgrade or new
domain is recommended here. Prices are public starting prices, not a quote for
this organization's eventual bill. [Pricing](https://supabase.com/pricing),
[backup policy](https://supabase.com/docs/guides/platform/backups),
[managed clone restrictions](https://supabase.com/docs/guides/platform/clone-project).

## 2. Current recovery inventory and important limitation

A metadata-only query under `read_only=true` confirmed:

- Auth users: **0**. Native Vault secrets: **0**. No HQ objects or migration ledger.
- Source `postgres` can SELECT Vault ciphertext and INSERT Auth users.
- Source `postgres` **cannot INSERT or UPDATE `vault.secrets`**. Managed roles and
  internal Vault crypto helpers belong to Supabase and cannot be recreated or
  administered wholesale by an ordinary migration login.

The initial empty Auth/Vault baseline can be validated without copying a Vault
root key because there is no ciphertext to recover. Recheck counts immediately
before capture; that exception stops applying as soon as encrypted data exists.
Do not infer that other managed tables are empty from these two counts.

The CLI's default schema export filters managed schemas, and default data export
excludes Vault and migration history. Its role export omits passwords and filters
reserved role operations. Therefore three ordinary dump files alone do not prove
complete recovery. Capture managed-role/ACL metadata and explicit supplements.
[CLI schema/data filtering](https://github.com/supabase/cli/blob/v2.120.0/apps/cli-go/pkg/migration/dump.go),
[role export behavior](https://github.com/supabase/cli/blob/v2.120.0/apps/cli-go/pkg/migration/scripts/dump_role.sh).

## 3. Precise backup capture procedure — future execution only

1. Name the operator, approved encrypted off-site destination, recovery-point
   objective, and downtime budget. Use an existing database password through a
   hidden prompt/process environment, never a password-bearing command argument,
   source file, transcript, or new CLI login role. Verify TLS and the exact project.
2. Confirm the source is stable for all captures. At this first deployment there
   are no HQ clients/users/functions yet, but public Auth signup is still enabled.
   Compare pre/post counts and schema/ACL fingerprints; stop and recapture if they
   change. A future busy system needs an approved maintenance window or a
   coordinated PostgreSQL snapshot; separately captured files are not one snapshot.
3. Record source PostgreSQL 17.11, GoTrue v2.197.0, Vault 0.3.1, extension versions,
   table/column inventories, all relevant row counts, owners, expanded ACLs/grant
   options, policies, RLS/FORCE RLS, role memberships, and default privileges.
   Include Auth and Vault customizations and any Storage/Realtime dependencies.
   Record the existing expired CLI role as metadata, not a role to reactivate.
4. Capture the following files. `$backupDir` must be a preselected protected local
   directory outside source; encrypt the package immediately and retain a second
   encrypted copy. These commands have **not** been run:

```powershell
$cli = 'C:\Users\kenne\HQ-Bubble-Build\.tooling\supabase\supabase.exe'
$backend = 'C:\Users\kenne\HQ-Bubble-Build\integration\add-to-job'
# Supply backupDir and the EXISTING password securely before invoking.
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_PASSWORD)) { throw 'Existing password required' }
$env:SUPABASE_PROJECT_ID = 'ixtnmcrtgcyojqrthbhw'
& $cli db dump --linked --workdir $backend --role-only --file "$backupDir/roles.sql"
if ($LASTEXITCODE -ne 0) { throw 'Role export failed' }
& $cli db dump --linked --workdir $backend --file "$backupDir/schema.sql"
if ($LASTEXITCODE -ne 0) { throw 'Schema export failed' }
& $cli db dump --linked --workdir $backend --data-only --use-copy --file "$backupDir/data.sql"
if ($LASTEXITCODE -ne 0) { throw 'Data export failed' }
# Default data export includes Auth, but explicitly capture Vault ciphertext.
& $cli db dump --linked --workdir $backend --schema vault --data-only --use-copy --file "$backupDir/vault-data.sql"
if ($LASTEXITCODE -ne 0) { throw 'Vault export failed' }
# Clear/restore environment variables in finally. Never log their values.
```

5. Inspect generated SQL privately for coverage, without printing data. Verify
   `data.sql` includes the required Auth tables and application/private data; inspect
   the explicit Vault export's table coverage. Preserve IDs, ciphertext, nonce,
   timestamps, and any encryption-key reference. Never export the decrypted view
   as a table backup. Capture history schema/data separately **only when the
   history relation exists**; the current pre-deployment source has none.
6. Store managed schema/ACL/role metadata as `managed-baseline.json` and source
   table/count/column inventory as `inventory.json`. Preserve custom managed-schema
   triggers/policies/DDL separately if any exist. Do not replay an entire managed
   Auth/Vault schema over an initialized Supabase target.
7. Separately record Auth settings, callback allow lists, signing-key IDs/algorithms,
   SMTP configuration, runtime secret **names**, function source/lockfile hashes,
   deployment versions, Storage object coverage, and DNS/client URLs. Existing
   secret values, where recovery needs them, require approved secure custody;
   metadata cannot recreate those values.
8. Generate SHA-256 checksums, record capture time/exit codes/tool versions, and
   encrypt artifacts. Restore from the encrypted package's decrypted working copy
   in a protected directory; destroy temporary plaintext copies only after verified
   encrypted copies and the rehearsal exist. Do not mark the gate passed merely
   because dump commands exit successfully.

The supported starting point is Supabase's separate roles/schema/data workflow.
Additional files above address this project's measured gaps.
[Backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## 4. Isolated restore procedure

**Target:** a fresh local Supabase stack named `firstrate-hq-restore-rehearsal`,
with proposed API 55451, DB 55452, and shadow DB 55450. Check availability first.
It must have no hosted link and must not use current QA ports 54321/54322 or the
hosted project. No target has been started or initialized in this preparation.

Use PostgreSQL 17.11, GoTrue v2.197.0, Vault 0.3.1, and matching managed-table
definitions. Initialize the target's normal managed services/roles first. Disable
outbound mail, external workers/webhooks, and production client access in the
isolated environment. Do not apply HQ migrations before restoring a pre-HQ baseline.

Before import, compare every included table/column with the target. Stop on a
version mismatch; do not remove nonempty COPY blocks or suppress errors to make
the restore pass. Review filtered `roles.sql` for only portable custom-role changes.
Reserved platform roles come from target initialization; verify their semantics
and app-relevant permissions against metadata. Do not recreate the expired CLI
login or replace managed roles with superusers.

With a securely configured existing target-local password, use the installed
PostgreSQL 17 client and a strictly loopback target:

```powershell
$psql = 'C:\Users\kenne\HQ-Bubble-Build\.tooling\phase1-postgresql\pgsql\bin\psql.exe'
# PGPASSWORD, if required, belongs to the LOCAL target and stays off command lines.
& $psql -h 127.0.0.1 -p 55452 -U postgres -d postgres `
  --single-transaction --set ON_ERROR_STOP=1 `
  --file "$backupDir/roles.sql" --file "$backupDir/schema.sql" `
  --command 'SET session_replication_role = replica' `
  --file "$backupDir/data.sql"
if ($LASTEXITCODE -ne 0) { throw 'Isolated restore failed; retain evidence' }
```

Use only after target identity and SQL review. Trigger bypass is confined to the
restore session; reconnect for normal verification. Validate foreign-key orphans,
checks, owners, policy behavior, and ledger/hold integrity afterward. Managed ACL
customizations must be reconciled by an authorized target administrator from the
captured baseline, never by blanket grant/revoke scripts against the source.

**Current zero-secret case:** verify the explicit Vault artifact records an empty
source table, and that target native Vault is empty with equivalent extension,
owners, grants, and browser denials. Do not issue an empty COPY into protected
Vault as `postgres`; even empty COPY can require INSERT. No key transfer is needed
to restore zero ciphertext rows. Include this explicit exception in the results.

**Any nonzero ciphertext case:** stop before import unless both key portability
and an authorized Vault data-import path are verified. A local target administrator
may have appropriate restore privileges; a managed target's `postgres` may not.
Do not assume `vault.create_secret()` preserves IDs. Recreating secrets would need
a separately approved remapping/rebinding of all dependent credential UUIDs and
verification of equivalent state. Prefer a tested supported import/managed restore
path; obtain provider guidance if protected-table import remains unavailable.

Supabase's per-project root key is outside SQL backups. Same-project restoration
keeps its encryption context; a manual new-project restore needs the old context.
The `/pgsodium` Management API returns/accepts the root key for active projects.
Any target PUT is a separately approved hosted change; never overwrite a nonempty
target's key. A local target needs a validated key-loader procedure for its exact
image; do not substitute Supavisor's encryption setting for Vault's root key.
That nonzero-secret local key-loader procedure has not been rehearsed here.
[Vault key portability](https://supabase.com/docs/guides/database/vault).

### Pass criteria and restoration limits

Record target identity, package checksums, operator, elapsed time, and results:

- Exact table/column coverage and included row counts match. Current Auth/Vault
  counts restore as zero; no HQ history or objects appear in a pre-HQ restore.
- Compare owner names, expanded effective ACLs, role memberships, policies,
  RLS/FORCE RLS, default grants, and extension/function dependencies.
- Verify anon/authenticated Vault denial and the current server access contract.
  Once encrypted secrets exist, require server decryption after restore, using
  a non-sensitive fixture/secure comparison rather than logging plaintext.
- Real Auth account/password usability cannot be demonstrated from a zero-user
  source. A separate synthetic local Auth/Vault recovery fixture can extend the
  test after authorization; the source project must remain untouched.
- New-target JWT/API signing material is not automatically restored by SQL.
  Reauthentication may be required. SQL role passwords are omitted. Auth settings,
  SMTP secrets, API keys, functions, and Storage object bytes need separate recovery.
- Cross-schema counts alone do not prove transaction consistency. Preserve pending
  holds/submission identities; database restore cannot undo an external HCP write.

This procedure can verify the **current empty baseline** without PITR. It is not
a promise of complete future encrypted-secret/platform recovery. Expand and
rehearse it before real credentials/users or live HCP are introduced.
[Self-hosted restore limits](https://supabase.com/docs/guides/self-hosting/restore-from-platform).

## 5. Required Auth and origin plan

The user selected **production origin only initially; testing/callback values
remain pending**. Native source verifies the page and origin below, and a HEAD
request returned HTTPS 200 with no redirect. The static page's own wildcard CORS
header does not configure the Edge Function's CORS policy.

| Item | Planned value / behavior |
| --- | --- |
| Existing HQ page | `https://kenthegreat123.github.io/1st-Rate-Parts-App/` |
| Approved initial Edge CORS origin | `https://kenthegreat123.github.io` — no path or trailing slash |
| Testing origins | Empty, per user selection; do not add localhost, LAN HTTP, null, or appassets origins to hosted allow list |
| Hosted Auth public signup | `disable_signup=true` |
| Anonymous signup | `external_anonymous_users_enabled=false` |
| Email provider | `external_email_enabled=true`; closing signup must not disable invited-user login |
| Email confirmation | `mailer_autoconfirm=false` |
| Auth Site URL candidate | Existing HQ HTTPS page above; a landing URL is not proof of callback support |
| Callback allow list | Pending an exact implemented/approved HTTPS callback; no invented /auth/callback route or wildcard |
| User admission | Approved staff only through Dashboard invite or trusted server Admin API; no browser service-role key |
| HQ authorization | Server creates hq_users and active account membership with an explicitly approved role; Auth invitation alone confers no tenant rights |

The existing interface uses its own login/PIN flow and has no established Supabase
invitation callback integration in the reviewed files. Do not send staff invitations
to an unimplemented callback or assume the homepage handles Supabase session tokens.
Keep invitation activation pending callback/frontend work under separate approval.
No production website or Android changes are included in this plan.

Default Supabase email only reaches organization team addresses, is limited to
2 messages/hour, and has no production delivery guarantee. Do **not** make staff
Supabase organization administrators just to receive invitations. Use approved
custom SMTP for ordinary HQ users; it is configurable on Free, with any external
provider/domain costs reported before setup. No SMTP credentials were created,
read, or configured here. [SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp).

## 6. Exact Edge CORS contract — corrected locally

Current backend permits POST/OPTIONS and the required headers
`authorization,apikey,content-type,x-client-info,x-hq-account`. The approved
production origin is hard-capped in the entrypoint; unset configuration fails
closed. Local CORS/security regression tests passed; no hosted deployment occurred.
JWT validation and account membership remain mandatory. The latest execution
gates supersede the historical sequence below: [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md).

All GitHub Pages repositories under the same account share this origin. CORS
cannot distinguish paths; a future testing path on that host would share the same
origin. Use a distinct approved HTTPS host if independent testing allowlisting is
needed. The Android trusted-document path restriction is a different control.

## 7. Dashboard versus commands

| Action | Dashboard / operator option | Command/API option |
| --- | --- | --- |
| Review plan, usage, available backups | Organization Billing; Database Backups | Read-only Management API |
| Logical backup and local restore | No equivalent Free managed restore button | CLI db dump and local psql procedure |
| Disable public/anonymous signup; keep email login | Authentication provider/signup settings | Approved Management API Auth PATCH; no migration required |
| HTTPS Site URL and callback allow list | Authentication URL Configuration | Approved Auth config PATCH |
| Custom SMTP and approved user invites | Authentication SMTP and Users | Approved SMTP config and trusted server Auth Admin API |
| Tenant profile/membership provisioning | Controlled reviewed SQL/admin operations after schema exists | Server-only provisioning; never client writes or public signup metadata |
| HQ_ALLOWED_ORIGINS | Edge Function Secrets, despite value being non-secret configuration | Approved CLI secrets set; does not require a function redeploy |
| Ordered HQ database migrations | SQL Editor could execute SQL but bypasses the reviewed CLI/history workflow | Use reviewed CLI db push with exact three-file history |
| Edge function and changed CORS code | Dashboard function editor exists but would diverge from repository evidence | Deploy reviewed source with CLI; keep verify_jwt=true |
| Root-key transfer / managed recovery | Supported managed restore flows where plan permits | Manual transfer/import needs separate authorization and verified privileges |

No setting above is applied by merely editing local config.toml. No HCP key is
needed for Phase 1, and the entrypoint keeps reads/writes hard-disabled.

## 8. Minimal execution sequence and approval boundaries

1. **Backup preparation:** authorize secure export/custody and a new local isolated
   restore target. Capture the current baseline and prove the zero-user/zero-secret
   restore, owners/grants, and package integrity. Cost: no required plan upgrade.
   Stop if data changes or nonzero Vault content introduces the unverified branch.
2. **Hosted configuration:** separately approve closing signup and production-only
   CORS. Decide HTTPS Auth landing/callback and SMTP before enabling invitations.
   The local plan/draft may be reviewed now; no invites, keys, settings, or secrets
   may be created until authorized. Client callback work is outside this turn.
3. **Database deployment:** after baseline recovery passes, refresh metadata/hashes,
   rerun the guarded dry-run, then obtain explicit approval for exactly the three
   reviewed migrations. Use existing password and --skip-vault; no seeds, role
   includes, reset, include-all, or history repair. Apply database only first.
4. **Edge/acceptance:** separate approval for exact-origin runtime configuration
   and reviewed function deployment. Keep JWT verification and HCP gates closed.
   Use an approved API test client; SDK-browser activation waits for its CORS fix,
   callback support, and invited-user onboarding. Verify hosted ES256, RLS, CORS,
   and LIVE_REQUESTS_DISABLED before declaring hosted acceptance.

**NO-GO for deployment/activation now; GO to execute the proposed preparation only
after its specific authorization.** The migration dry-run/local tests are passed.
Outstanding evidence is the captured/restored baseline; outstanding configuration
is closed onboarding/HTTPS/CORS; invitation/SDK-browser use has the callback,
SMTP, and header limitations above. PITR is not a prerequisite.
