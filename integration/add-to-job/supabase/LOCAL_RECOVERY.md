# Local runtime and recovery verification - 2026-10-11

Work stayed on bubble-add. No system-level software or Windows features were
installed/enabled in this turn. No hosted requests, migrations, credentials,
Auth settings, production HQ, Android changes, commits or pushes occurred.

## Runtime blocker and exact Windows setup

Docker Desktop 4.94.0 and Docker client 29.8.2 are installed. Desktop reports
stopped; the Linux engine returned HTTP 500 instead of server version details.
The official Supabase CLI 2.120.0 exists at:
`C:\Users\kenne\HQ-Bubble-Build\.tooling\supabase\supabase.exe`.
WSL reports that it is not installed. The computer reports a hypervisor present;
this does not prove all Docker hardware prerequisites. Windows optional-feature
inspection required an administrator token, so their exact states are unknown.

Approval is required before the assistant installs/enables system components.
The user can instead perform these steps deliberately:

1. Open **PowerShell as Administrator**, install WSL without an extra Linux distro:

   ```powershell
   wsl --install --no-distribution
   ```

2. Restart Windows if prompted. After restart, update/check WSL:

   ```powershell
   wsl --update
   wsl --version
   ```

3. Docker requires WSL 2.1.5 or newer. Open Docker Desktop, select its WSL 2/Linux
   container backend, and wait for the engine to run. Verify the actual server:

   ```powershell
   & 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' info --format '{{.ServerVersion}}'
   ```

No separate Ubuntu distribution or Docker reinstallation is currently indicated.
If WSL setup reports missing Windows features, an administrator can inspect:

```powershell
Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux
```

Feature enabling, BIOS/UEFI changes, or a Windows restart still require the user's
approval/control. These commands have NOT been executed to install anything.

Official references: [Microsoft WSL commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands),
[Docker Windows prerequisites](https://docs.docker.com/desktop/setup/install/windows-install/),
[Supabase local development](https://supabase.com/docs/guides/local-development/cli/getting-started).

Once the Docker server responds, use the existing dedicated local project:

```powershell
$cli = 'C:\Users\kenne\HQ-Bubble-Build\.tooling\supabase\supabase.exe'
$backend = 'C:\Users\kenne\HQ-Bubble-Build\integration\add-to-job'
& $cli start --workdir $backend
& $cli db reset --local --workdir $backend
& $cli test db --local --workdir $backend
```

These are local commands; never substitute --linked for --local. The project's
local ID is firstrate-hq-local. Before fixture creation, verify API/database
targets are loopback and distinct from the hosted project. Review container port
bindings/firewall so the local stack is not reachable from untrusted networks.

## Tests completed now

| Check | Result |
|---|---|
| Backend/SQLite/mock/UI/migration-atomicity regressions | 67 passed |
| Embedded PostgreSQL RLS/isolation/transaction tests | 36 passed |
| Native PostgreSQL 17.11 migration/RLS/isolation/transaction tests | 36 passed |
| Native independent-session contention | 5 passed |
| Deno Edge entrypoint check | Passed |
| Deno runtime tests | 2 passed |
| Fresh native cluster backup/restore security and uncertainty checks | Passed |
| Actual Supabase roles/extensions, Vault encryption, Auth sessions/JWT/Edge gateway | Blocked: Docker/WSL runtime |

Native tests include the final fail-closed Vault grant assertion. Auth and Vault
in these PostgreSQL suites are explicit fixtures, not actual Supabase services.
No existing migration or application behavior was changed. A new reusable
`test/database/recovery-verify.mjs` checks restore security and data invariants.

## Recovery rehearsal performed

Source: loopback PostgreSQL 17.11, port 55439, dedicated hq_phase1_test database.
Target: a **fresh separate PostgreSQL cluster**, port 55440, same database name,
bootstrap administrator hq_restore_admin. Both use disposable local fixtures.

1. Ran all migrations/tests against a fresh dedicated source database.
2. Prepared a confirmed mock material followed by an update with a lost response.
   Expected state: stock 8, reserved 1, one committed ledger entry, and an unknown
   submission requiring reconciliation. No live HCP transport was used.
3. Captured effective object grants, owners, function security settings, policies,
   role attributes and all 16 HQ tables' RLS settings.
4. Used pg_dump custom format with owners and ACLs retained, and pg_dumpall
   --roles-only --no-role-passwords. No hosted password was backed up or logged.
5. Initialized a fresh cluster without overwriting an existing path, restored
   test roles first, created the database with its original owner, then restored
   the custom archive with --exit-on-error.
6. Compared effective privileges, including grant options. PostgreSQL can encode
   equivalent owner-only grants as an explicit ACL or NULL default; the verifier
   expands both using aclexplode/acldefault rather than demanding identical text.
7. Verified server RPC EXECUTE, client RPC denial, Vault-fixture read denial,
   denied inventory mutation, account A visibility/account B isolation, stock,
   reservation, ledger append-only enforcement, and durable unknown status.
8. Ran the existing uncertain-submission probe against the restored database:
   recovery/replay made zero remote requests and did not release the hold.
9. Stopped the restore cluster, preserving artifacts for inspection.

Artifacts (ignored local tooling directory):
- `.tooling/phase1-recovery/database.dump`
- `.tooling/phase1-recovery/roles.sql` (password-free fixture roles)
- `.tooling/phase1-recovery/baseline.json` (permission/role metadata)
- `.tooling/phase1-recovery/restore-cluster/` (stopped restored test cluster)

Archive SHA-256:
`B39A8098E864C63DEE472A7E9A74E6BDCCC8265F3A4F3FBF9FE0F16A0BEB08CA`.

## Repeating the tested procedure

Use the dedicated source with the prepared fixture. From the workspace root:

```powershell
$pg = 'C:\Users\kenne\HQ-Bubble-Build\.tooling\phase1-postgresql\pgsql\bin'
$artifacts = 'C:\Users\kenne\HQ-Bubble-Build\.tooling\phase1-recovery'
$env:HQ_NATIVE_TEST_URL = 'postgresql://hq_local@127.0.0.1:55439/hq_phase1_test'
node integration/add-to-job/test/database/restart-check.mjs prepare-update
node integration/add-to-job/test/database/recovery-verify.mjs capture "$artifacts\baseline.json"
& "$pg\pg_dump.exe" -h 127.0.0.1 -p 55439 -U hq_local -d hq_phase1_test -Fc -f "$artifacts\database.dump"
& "$pg\pg_dumpall.exe" -h 127.0.0.1 -p 55439 -U hq_local --roles-only --no-role-passwords -f "$artifacts\roles.sql"
```

Choose a **new, nonexistent workspace directory** for a repeat target; do not
overwrite the retained restore cluster. Initialize with initdb -U hq_restore_admin
-A trust --encoding=UTF8 --locale=C. Start pg_ctl with -h 127.0.0.1 -p 55440,
after checking that port is free. Restore in this order and check every exit code:

```powershell
& "$pg\psql.exe" -h 127.0.0.1 -p 55440 -U hq_restore_admin -d postgres -v ON_ERROR_STOP=1 -f "$artifacts\roles.sql"
& "$pg\createdb.exe" -h 127.0.0.1 -p 55440 -U hq_restore_admin -O hq_local hq_phase1_test
& "$pg\pg_restore.exe" -h 127.0.0.1 -p 55440 -U hq_restore_admin -d hq_phase1_test --exit-on-error "$artifacts\database.dump"
$env:HQ_NATIVE_TEST_URL = 'postgresql://hq_local@127.0.0.1:55440/hq_phase1_test'
node integration/add-to-job/test/database/recovery-verify.mjs verify "$artifacts\baseline.json"
node integration/add-to-job/test/database/restart-check.mjs verify
```

Stop the target with pg_ctl -D <checked-absolute-target-directory> -m fast stop.
This trust-authenticated, loopback-only fixture procedure is not a hosted restore
recipe and must not be pointed at a customer database. The verification script
rejects non-loopback hosts, other database names and unexpected source/target ports.

## Remaining recovery and deployment gates

The fresh-cluster rehearsal proves native SQL data/role/permission recovery with
fixtures. It does not prove preservation of real Supabase Auth password/session
data, Vault ciphertext/encryption context, or managed internal-role restrictions.
Repeat the recovery rehearsal with a real isolated Supabase stack, its local
managed roles, issued test sessions, and native encrypted fake Vault secrets.
Verify browser denial and server decryption after restoration. Native Supabase
internal roles require a supported restore procedure rather than indiscriminately
replaying role DDL over a managed database.

Actual hosted backup availability, retention, full baseline coverage and restore
capability remain unverified. Do not restore/reset cloud, alter shared Vault ACLs,
repair history, or release uncertain holds without separate approval. Keep HCP
disabled. Recommendation remains NO-GO until real-stack security/Auth/Vault and
complete recovery gates pass.
