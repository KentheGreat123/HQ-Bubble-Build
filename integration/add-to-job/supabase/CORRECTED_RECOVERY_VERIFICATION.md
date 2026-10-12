# Corrected recovery verification — October 11, 2026

Project `ixtnmcrtgcyojqrthbhw`; branch `bubble-add`.
Backup `20261012T022301087Z`; isolated target **127.0.0.1:55452**.

**PASS — 45/45 checks under the explicitly approved source-recovery contract
with exact managed-platform exceptions.** The original strict comparison remains
**30/33 FAIL**, preserved unchanged. This is a separate corrected report, not a
rewrite of the original result or proof of identical hosted-platform initialization.

## Executed correction

Before the change, read-only preflight confirmed the fixed unlinked target,
existing supabase_admin identity/permissions, unchanged imported metadata,
reviewed backup checksums, all seven original evidence/guard file hashes, and
the exact four absent source index definitions. Encrypted package verification
also passed for all 17 manifest files and 18 archive entries.

One bounded transaction added only these four indexes on existing auth.users:

- auth.idx_users_created_at_desc
- auth.idx_users_email
- auth.idx_users_last_sign_in_at_desc
- auth.idx_users_name

Definitions exactly match the captured source. The transaction committed; each
index is valid/ready, nonunique, not constraint-backed and owned by the source's
supabase_auth_admin table owner. No role, grant, password, table, function, data,
Storage ledger, Iceberg object or webhook permission was changed. A correction
marker prevents automatic replay. Neither original restore guard was removed.

The original SQL draft's four definitions were executed by the guarded runner
[correct-and-verify-auth-indexes.mjs](recovery/correct-and-verify-auth-indexes.mjs).
The full draft was not blindly replayed, and no third import occurred.

## Verified recovery

After correction, the verifier used read-only transactions; an additional
read-only run independently passed all 45 checks:

- Public/Auth/Vault columns, table ownership, ACL/RLS flags, function permissions,
  constraints, indexes, triggers and schema permissions match the backup.
- RLS policies and all six required roles/memberships match; other role/membership
  differences are limited to the named managed-module/expired-CLI exceptions.
- Vault browser denials match. Auth/Vault are empty; no HQ objects/history were
  invented in the pre-HQ baseline. No Vault root key was read or transferred.
- All 33 exported COPY tables' row counts match. Every nonexcepted row count
  matches; no arbitrary data/schema exclusion was introduced.
- Compared with the original imported target, precisely four indexes were added.
  Every other captured metadata field remains identical.
- Managed webhook objects/current/default permissions, all Storage migration
  id/name/hash records, and local Iceberg tables remain identical to the reviewed
  pre-correction platform state. Public-only API configuration was verified.
- The original seven recovery evidence/guard files retain their recorded hashes.
  The backup files remain unchanged and outside Git.

## Exact approved platform exceptions

1. **Local database-webhook module:** source supabase_functions schema absent;
   the target's previously initialized schema, objects, existing/default grants,
   supabase_functions_admin role and its postgres membership were preserved.
   Its broad local grants are explicitly reported, not treated as source parity.
   Nonexcepted default privileges and memberships still compare exactly.
2. **Managed Storage migration:** all common source records match. The target-only
   record is id 73, revoke-grants-to-unused-operations, hash
   ba9244051be09f22f714fc0170a2539f8b5f0e68. No ledger row was rewritten/deleted.
3. **Storage topology:** source lacks storage.iceberg_namespaces/iceberg_tables;
   the target's two empty, RLS-enabled managed tables remain. No other unapproved
   table/count differences are accepted.
4. **Source expired CLI role:** cli_login_postgres and its postgres membership
   were deliberately not recreated; no credentials were minted.

The checks enforce these exact exceptions and preserve the reviewed target state;
they do not ignore whole schemas or allow future unrelated differences.
Rationale and the original correction review remain in
[RECOVERY_CORRECTION_PLAN.md](RECOVERY_CORRECTION_PLAN.md).

## Evidence and remaining limitations

Separate ignored evidence under `.tooling/phase1-hosted-restore`:
`auth-index-correction-preflight.json`, `auth-index-correction-execution.json`,
`auth-index-correction-attempted.marker`, `corrected-inventory.json`, and
`corrected-recovery-verification.json`. Original `restore-results.json` is unchanged.
No private contents, credentials or authorization headers were displayed.

This verifies the **current empty baseline** and the stated compatibility contract.
It does not verify a byte-for-byte hosted-platform clone, end-to-end Storage/
webhook service recovery, or usability of restored real Auth sessions/passwords.
There are no source users or ciphertext rows from which to prove those outcomes.
Future Vault key portability/decryption and credential linkage must be rehearsed
before real credentials/live operations. Portable encrypted off-site custody and
independent-machine decryptability remain unverified; DPAPI is Windows-user-bound.
Role passwords, signing/API keys, hosted Auth/SMTP/runtime settings/secrets, Edge
deployments and Storage object bytes require separate recovery coverage.

The scoped local restore verification gate now passes. Hosted Auth/origin settings,
callback/SMTP onboarding, off-site custody, rollback/operator readiness, final
review/dry-run, deployments and hosted ES256 acceptance remain separate work and
approval stages. No deployment or hosted settings change was performed.

Hosted Supabase, the existing local HQ test database, production HQ/Android and
live HCP were not touched. No commit, push, merge or database reset occurred.
