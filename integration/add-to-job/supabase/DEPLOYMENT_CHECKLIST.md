# Phase 1 checkpoint and deployment checklist

Project `ixtnmcrtgcyojqrthbhw`; branch `bubble-add` only.
This document supersedes earlier readiness conclusions and pending-work statements
in the historical reports. No hosted setting or deployment is applied here.

## Cleared evidence

- Native local Auth/JWT, Vault encryption/denials, tenant RLS, RPC, Edge behavior,
  inventory/idempotency/duplicate updates and uncertain-outcome recovery passed
  the previously recorded local integration suites. HCP transports were mocks.
- Corrected local CORS includes `x-client-info`; production origin is hard-capped
  in the Edge entrypoint and unset configuration fails closed. JWT verification
  remains enabled and HCP reads/writes are hard-disabled in source.
- User reported hosted dry-run with exactly the three reviewed migrations.
  Current migration bytes still match the local-tested/reviewed SHA256 values
  listed in `MIGRATION_SOURCE_SHA256.json`.
- Captured five baseline exports completed successfully; package/DPAPI integrity
  and corrected isolated recovery passed 45/45 with exact approved exceptions.
  Original 30/33 report is preserved; no fresh restore or reset is needed.
- Exact proposed checkpoint files and exclusions are in `PHASE1_CHECKPOINT_FILES.txt`
  and `CHECKPOINT_REVIEW.md`. Nothing is staged or committed by this preparation.

## Final hosted configuration proposal — separate approval required

Dashboard Authentication: disable public signup and anonymous sign-in; keep the
email provider enabled and email confirmation required. Draft API equivalents
are `disable_signup=true`, `external_anonymous_users_enabled=false`,
`external_email_enabled=true`, `mailer_autoconfirm=false` in
`HOSTED_CONFIGURATION_DRAFT.json`. Do not confuse disabled public signup with
disabling the email login provider. Review other enabled providers before execution.

Approved website: `https://kenthegreat123.github.io/1st-Rate-Parts-App/`.
Only approved CORS origin: `https://kenthegreat123.github.io` (no path/trailing slash).
No testing origin or callback has been approved; do not allow localhost, wildcard
URLs or preview origins on hosted Auth. The production page is only a Site URL
candidate, not a verified Auth landing/callback. Final exact HTTPS Site URL and
callback must be approved after an actual session-handling page is implemented
and verified, under separate frontend authorization. Do not send invitations yet.

Approved people must be invited by trusted Auth Admin/dashboard operations, with
server-provisioned HQ user/account membership and least-privilege role. Browser
metadata must never confer membership or admin status. No service key in browser
code. Invite acceptance must prove the correct account access and cross-tenant
denial. Configure approved custom SMTP before ordinary staff onboarding: default
SMTP is limited to organization team addresses, currently two messages/hour,
without delivery SLA. Do not make staff organization admins for email delivery.
Provider/domain costs require review before purchase/configuration.
[Supabase SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp).

Edge runtime configuration, only when separately authorized:
`HQ_ALLOWED_ORIGINS=https://kenthegreat123.github.io`.
CORS permits POST/OPTIONS and `authorization,apikey,content-type,x-client-info,x-hq-account`.
It echoes only the approved Origin with `Vary: Origin`; CORS cannot distinguish
repositories sharing the GitHub Pages hostname. Auth and tenant permissions
remain mandatory for requests without an Origin.

Dashboard can change Auth provider/signup flags, URL allowlists, SMTP, approved
invites and Edge configuration. These are cloud changes requiring approval.
Database migrations and function code should use reviewed CLI deployment, rather
than dashboard edits that diverge from the checkpoint. Local config.toml changes
do not configure the hosted project. No HCP credential is required for Phase 1.

## Minimal execution order and outstanding gates

1. **Checkpoint:** approve the exact file list, then create one local source commit.
   Review staged diff/secrets and hash agreement before committing; no push implied.
   Use proposed message `Prepare Phase 1 Supabase backend and verified baseline recovery`.
2. **Backup custody:** execute `PORTABLE_OFFSITE_BACKUP.md` under scoped approval,
   choose custodians/destinations and prove independent-machine decrypt/package
   integrity. DPAPI is not portable. Preserve all original recovery evidence.
3. **Hosted safety configuration:** separately approve closed signup and approved
   origins. Resolve HTTPS landing/callback and SMTP before invitations/activation.
   These onboarding gates need not imply production website edits in this checkpoint.
4. **Final read-only preflight:** pin the checkpoint commit and runtime/migration
   hashes; refresh linked project identity, source inventory and configuration.
   Stop if users, ciphertext, HQ objects or migration history appeared since backup;
   the current empty baseline is then insufficient. Update the old dry-run guard's
   tested source manifest only from reviewed passing evidence; it currently pins
   the earlier pre-CORS source and must not be bypassed. Rerun guarded dry-run and
   confirm exactly the same three files before deployment approval.
5. **Database deployment:** separate approval for three migrations only; use the
   existing password, linked project, reviewed CLI and `--skip-vault`. No reset,
   history repair, include-all, seeds or role import. Preserve operator access and
   a supported isolated recovery path; do not promise an automatic reverse migration.
6. **Edge deployment:** separate approval for reviewed function/configuration only.
   Keep verify_jwt=true; never use `--no-verify-jwt`. Do not enable HCP flags.
7. **Hosted acceptance:** approved invited test identity and HTTPS callback/client
   must verify ES256 gateway acceptance, membership/RLS, Vault denial, CORS and
   LIVE_REQUESTS_DISABLED. No live HCP request or credential provisioning.
   Staff activation stays blocked until this and onboarding gates pass.

## Exact future deployment commands — DO NOT RUN YET

From the repository root, after final guard/review and separate cloud approval:

```powershell
$env:SUPABASE_PROJECT_ID = 'ixtnmcrtgcyojqrthbhw'
# Existing database password must be supplied securely by the guarded operator
# flow; never paste it into these commands or allow a temporary CLI login role.
& '.\.tooling\supabase\supabase.exe' db push --linked --skip-vault --workdir '.\integration\add-to-job'
if ($LASTEXITCODE -ne 0) { throw 'Migration apply failed; stop without reset/history repair' }
# Only after separate approval; HQ_ALLOWED_ORIGINS is nonsecret configuration.
& '.\.tooling\supabase\supabase.exe' secrets set 'HQ_ALLOWED_ORIGINS=https://kenthegreat123.github.io' --project-ref 'ixtnmcrtgcyojqrthbhw' --workdir '.\integration\add-to-job'
if ($LASTEXITCODE -ne 0) { throw 'Runtime configuration failed; stop' }
& '.\.tooling\supabase\supabase.exe' functions deploy job-materials --project-ref 'ixtnmcrtgcyojqrthbhw' --workdir '.\integration\add-to-job'
if ($LASTEXITCODE -ne 0) { throw 'Function deployment failed; stop' }
```

These are command arguments for the approved guarded operator flow, not a safe
standalone password/bootstrap script. Verify branch, link, CLI digest and all
source hashes first, restore temporary environment variables afterward, and
preserve sanitized execution evidence. Do not run the sequence as a single approval.

## Recovery boundaries and recommendation

Free-plan snapshot inspection showed no accessible managed restore points/PITR;
this logical empty-baseline rehearsal does not require a paid upgrade. Reconfirm
plan availability before execution. Off-site media/cloud and SMTP provider costs
are variable and not approved. No plan upgrade or purchase is recommended here.

The scoped recovery PASS accepts precisely the reviewed webhook defaults/role,
Storage migration 73/empty Iceberg tables, and expired source CLI-role differences.
It is not a complete managed-platform clone. Nonempty Auth usability and Vault
encryption-context portability are unverified. SQL omits passwords, signing/API
keys, hosted settings/SMTP/runtime secrets, function releases and Storage bytes.
These limits block real-user/live-credential operation until covered. No SQL
restore can undo HCP actions; Phase 1 remains disconnected.

**GO for approval of the reviewed local checkpoint. NO-GO for hosted deployment
today:** off-site custody, final source-pinned preflight/dry-run, hosted safety
configuration/operator recovery readiness and explicit deployment approvals remain.
No commit, push, deployment or hosted configuration change has been performed.
