# Portable recovery custody — proposed, not executed

For project `ixtnmcrtgcyojqrthbhw`, baseline `20261012T022301087Z`.
The local package and scoped isolated SQL recovery pass. DPAPI alone cannot
recover this package on another computer/user. No off-site copy is verified yet.

Use portable authenticated encryption of a custody envelope containing the existing
`backup.zip` (original manifest and all 17 captured files), the separate
`capture-complete.json`, and the original/corrected recovery evidence. The completion
marker was written after the original ZIP and is not inside it. Do not upload raw SQL, plaintext
ZIP, runtime status, passwords, PATs, or local test logs. Keep the original
protected directory and recovery evidence unchanged.

## Preparation and costs

Use the official [age Windows distribution](https://github.com/FiloSottile/age).
The tool has no license fee. Installing it, choosing a storage destination, and
making a copy have not been performed. Verify the installer/source and record
the version; official binary releases offer Sigsum verification. Portable storage,
off-site USB custody, cloud storage, and a password manager may have separate
costs; use existing approved facilities where possible. No Supabase upgrade or
PITR purchase is necessary for this empty-baseline logical rehearsal.

Choose a strong unique passphrase stored in a recoverable password manager with
an independent recovery method, plus a separately secured emergency copy. Keep
it separate from the archive/media. Never place it in a command, script, Git,
environment variable, email, or chat. An encrypted archive with its only password
on this PC does not resolve recovery. Existing separately held age recipient keys
are an alternative, but this procedure does not create keys or credentials.

## Operator procedure on this computer

Run interactively in PowerShell without transcription, after preparation approval.
Use the already restricted backup directory; stop if its user/SYSTEM-only ACL has
changed. Confirm branch/project and verify the original package first:

```powershell
Set-Location 'C:\Users\kenne\HQ-Bubble-Build'
$ErrorActionPreference = 'Stop'
$baseline = 'C:\Users\kenne\HQ-Bubble-Build\.tooling\phase1-hosted-backups\20261012T022301087Z'
& '.\integration\add-to-job\supabase\Verify-HostedBaselinePackage.ps1' -BackupDirectory $baseline
$archive = Join-Path $baseline 'portable-custody.zip'
$portable = Join-Path $baseline 'baseline-portable.zip.age'
if (Test-Path -LiteralPath $archive) { throw 'Custody envelope already exists; do not overwrite it' }
if (Test-Path -LiteralPath $portable) { throw 'Portable output already exists; do not overwrite it' }
$custodyFiles = @(
  (Join-Path $baseline 'backup.zip'),
  (Join-Path $baseline 'capture-complete.json'),
  '.\.tooling\phase1-hosted-restore\restore-results.json',
  '.\.tooling\phase1-hosted-restore\corrected-recovery-verification.json',
  '.\.tooling\phase1-hosted-review\investigation-evidence-preservation.json'
)
Compress-Archive -LiteralPath $custodyFiles -DestinationPath $archive -ErrorAction Stop
& age.exe --passphrase --output $portable $archive
if ($LASTEXITCODE -ne 0) { throw 'Encryption failed; do not copy partial output' }
$cipherHash = (Get-FileHash -LiteralPath $portable -Algorithm SHA256).Hash
$plainHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
```

Age prompts for the passphrase. Use `--output`; Windows PowerShell binary
redirection/pipelines must not carry the ZIP. Record both hashes, baseline ID,
project, age version, custody contacts and recovery instructions in a protected
recovery record. Keep a trusted copy of that record independently; a hash beside
an archive alone does not prove its provenance. Do not display backup contents.

Copy only the `.age` archive and the nonsecret ciphertext checksum to an approved
off-computer destination. Prefer a disconnected USB kept securely off-site and
a second encrypted copy in an existing approved cloud account with MFA. Never
include the passphrase in either location. Compare each copied ciphertext hash
to `$cipherHash`; use provider versioning/retention where already available.
No particular destination, provider purchase, upload, or credential creation is
authorized by this document. Do not add these files to Git, even encrypted.

## Independent-machine acceptance

On another trusted computer, retrieve an off-site copy and the independent record.
Verify the ciphertext SHA256 before decrypting. Create a new, empty restricted
directory on an encrypted local volume accessible only to the recovery operator
and administrators/SYSTEM. Do not use a synced folder or an existing restore DB.

```powershell
# Set these two paths to the downloaded ciphertext and NEW protected output file.
if (Test-Path -LiteralPath $restoredZip) { throw 'Refusing existing plaintext output' }
& age.exe --decrypt --output $restoredZip $downloadedArchive
if ($LASTEXITCODE -ne 0) { throw 'Decryption failed; do not use partial output' }
if ((Get-FileHash -LiteralPath $restoredZip -Algorithm SHA256).Hash -ne $expectedPlainHash) {
  throw 'Plaintext package checksum mismatch'
}
```

The variables must come from the operator's chosen protected paths and trusted
record; no passphrase is assigned to them. Validate the envelope's exact five
unique basename entries listed above, prohibiting traversal. Verify its embedded
`backup.zip` contains exactly 18 unique basename entries and verify all 17 file
SHA256 values against its manifest. Confirm project,
five successful exports, unchanged source inventory and capture-complete status.
The current DPAPI verifier is Windows-user-bound: do not use it as a portable
verification substitute or silently skip its DPAPI branch. A portable verifier
and new isolated SQL rehearsal on the recovery machine need separate reviewed
execution. This turn does not authorize another database restore/reset.

Record independent decrypt/package verification, both copy checksums, custodians,
date and storage retrieval test. Until those tests pass, mark off-site recovery
**unverified**. Never delete the original baseline/evidence. Any later disposal
of temporary plaintext requires separately scoped, path-checked handling; SSD
file deletion alone is not proof of erasure.

## Coverage and limitations

This baseline has no real Auth users or Vault ciphertext. The 45/45 scoped SQL
verification covers exported data, roles/memberships, ownership, ACLs, RLS,
Auth/Vault definitions and the exact approved managed-service exceptions.
The logical package does not include role passwords, project signing/API keys,
hosted Auth/SMTP configuration, Edge deployments/secrets or Storage object bytes.
Recover those separately through approved operators and secure credential custody;
do not put plaintext cloud credentials into this package or Git.

Before any real Vault/HCP credential exists, rehearse supported root-key/encryption
context transfer and dependent secret UUID recovery. Before real users exist,
rehearse Auth usability/session recovery or explicitly document reauthentication.
SQL rollback cannot undo external HCP actions. Nothing in this procedure grants
authority to modify the hosted encryption context or to enable HCP traffic.
