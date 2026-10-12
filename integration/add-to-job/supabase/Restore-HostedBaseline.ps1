param([Parameter(Mandatory=$true)][string]$BackupDirectory,[switch]$ApprovedExistingLocalAdminRetry)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Invoke-GuardedNative.ps1')
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$root=[IO.Path]::GetFullPath((Join-Path $workspace '.tooling/phase1-hosted-backups'))
$backup=[IO.Path]::GetFullPath($BackupDirectory)
if (-not $backup.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {throw 'Backup must be under the protected backup root'}
$target=Join-Path $workspace '.tooling/phase1-hosted-restore'
$psql=Join-Path $workspace '.tooling/phase1-postgresql/pgsql/bin/psql.exe'
if (Test-Path "$target/supabase/.temp/project-ref") {throw 'Refusing linked target'}
if (-not (Test-Path "$target/status.json")) {throw 'Start the new isolated target first'}
if ((Get-Content "$target/supabase/config.toml" -Raw) -notmatch 'project_id = "firstrate-hq-restore-rehearsal"') {throw 'Wrong restore project'}
$isRetry=Test-Path "$target/restore-attempted.marker"
if($isRetry -and -not $ApprovedExistingLocalAdminRetry){throw 'A restore was already attempted; refuse replay/reset without separate local admin approval'}
if($ApprovedExistingLocalAdminRetry -and -not $isRetry){throw 'Admin retry is restricted to the previously verified rolled-back attempt'}
if($ApprovedExistingLocalAdminRetry -and (Test-Path "$target/admin-retry-attempted.marker")){throw 'Admin retry already attempted; refuse automatic replay/reset'}
if($ApprovedExistingLocalAdminRetry){
 $proof=Get-Content (Join-Path $workspace '.tooling/phase1-hosted-review/restore-readonly-verification.json') -Raw | ConvertFrom-Json
 if($proof.port -ne 55452 -or $proof.transaction_read_only -ne 'on' -or @($proof.before_equals_after.PSObject.Properties | Where-Object {$_.Value -ne $true}).Count -ne 0){throw 'Read-only rollback proof missing or failed'}
}
$restoreRole=if($ApprovedExistingLocalAdminRetry){'supabase_admin'}else{'postgres'}
$status=Get-Content "$target/status.json" -Raw | ConvertFrom-Json
$uri=[Uri]$status.DB_URL
if ($uri.Host -ne '127.0.0.1' -or $uri.Port -ne 55452 -or $uri.AbsolutePath -ne '/postgres') {throw 'Refusing non-isolated DB URL'}
$manifest=Get-Content "$backup/manifest.json" -Raw | ConvertFrom-Json
if (-not (Test-Path "$backup/capture-complete.json")) {throw 'Capture not marked complete; refuse partial backup'}
$captureStatus=Get-Content "$backup/capture-complete.json" -Raw | ConvertFrom-Json
if ($captureStatus.status -ne 'captured' -or -not $captureStatus.restore_allowed) {throw 'Incomplete capture; refuse restore'}
if ($manifest.project -ne 'ixtnmcrtgcyojqrthbhw') {throw 'Unexpected source project'}
foreach($file in $manifest.files) {
 if ($file.file -ne [IO.Path]::GetFileName($file.file)) {throw 'Invalid manifest path'}
 if ((Get-FileHash -LiteralPath (Join-Path $backup $file.file)).Hash -ne $file.sha256) {throw 'Backup checksum mismatch'}
}
Add-Type -AssemblyName System.Security
$cipher=[IO.File]::ReadAllBytes("$backup/backup.dpapi")
$plain=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
$zip=[IO.File]::ReadAllBytes("$backup/backup.zip")
$sha=[Security.Cryptography.SHA256]::Create()
try {
 if ([Convert]::ToBase64String($sha.ComputeHash($plain)) -ne [Convert]::ToBase64String($sha.ComputeHash($zip))) {throw 'Encrypted backup round-trip mismatch'}
}finally{[Array]::Clear($plain,0,$plain.Length);[Array]::Clear($zip,0,$zip.Length);$sha.Dispose()}
$source=(Get-Content "$backup/inventory-after.json" -Raw | ConvertFrom-Json)[0].metadata
if ($source.auth_users -ne 0 -or $source.vault_secrets -ne 0 -or $source.hq_objects -ne 0 -or $source.history_exists) {throw 'Only reviewed empty baseline is supported'}
$savedPassword=$env:PGPASSWORD;$savedOptions=$env:PGOPTIONS
$login=$uri.UserInfo.Split([char[]]':',2)
if ([Uri]::UnescapeDataString($login[0]) -ne 'postgres') {throw 'Unexpected local restore role'}
function Invoke-Local([string[]]$SqlArguments,[string]$Log) {
 $result=Invoke-GuardedNative -Executable $psql -Arguments (@('-X','-h','127.0.0.1','-p','55452','-U',$restoreRole,'-d','postgres','--set','ON_ERROR_STOP=1')+$SqlArguments)
 @{exit_code=$result.ExitCode;diagnostic=$result.Diagnostic} | ConvertTo-Json | Set-Content $Log
 if ($result.ExitCode -ne 0) {throw "Local SQL failed (exit $($result.ExitCode)); raw SQL diagnostics withheld. Do not reset/retry or suppress errors."}
}
function Read-Inventory([string]$Name) {
 $path=Join-Path $target $Name
 $argsForInventory=@('-X','-h','127.0.0.1','-p','55452','-U',$restoreRole,'-d','postgres','--set','ON_ERROR_STOP=1','-q','-A','-t')
 if($ApprovedExistingLocalAdminRetry){
  $schemas=@($proof.canonical_search_path)
  if($schemas.Count -eq 0 -or @($schemas | Where-Object {$_ -notmatch '^[a-z_][a-z0-9_]*$'}).Count){throw 'Reference metadata search path invalid'}
  # Render types/defaults under the original role's path so qualification
  # differences cannot masquerade as schema changes. No role grant/change.
  $argsForInventory+=@('--command',('SET search_path = '+($schemas -join ',')))
 }
 $argsForInventory+=@('--file',"$PSScriptRoot/backup-baseline-inventory.sql")
 $result=Invoke-GuardedNative -Executable $psql -Arguments $argsForInventory -CaptureOutput
 if ($result.ExitCode -ne 0) {throw "Local metadata inventory failed (exit $($result.ExitCode)); raw diagnostics withheld"}
 $result.StandardOutput | Set-Content $path
 return Get-Content $path -Raw | ConvertFrom-Json
}
function Normalize($Value) {return ConvertTo-Json -InputObject $Value -Depth 30 -Compress}
try {
 $env:PGPASSWORD=if($login.Length -eq 2){[Uri]::UnescapeDataString($login[1])}else{''}
 $env:PGOPTIONS='-c default_transaction_read_only=on'
 $before=Read-Inventory $(if($ApprovedExistingLocalAdminRetry){'inventory-before-admin-retry.json'}else{'inventory-before.json'})
 if($ApprovedExistingLocalAdminRetry){
  $original=Get-Content "$target/inventory-before.json" -Raw | ConvertFrom-Json
  if((Normalize $before) -ne (Normalize $original)){throw 'Target changed since rolled-back attempt; no retry'}
 }
 if ($before.auth_users -ne 0 -or $before.vault_secrets -ne 0 -or $before.hq_objects -ne 0 -or $before.history_exists) {throw 'Target is not an empty pre-HQ baseline'}
 if ($before.server_version -ne $source.server_version) {throw 'PostgreSQL version mismatch'}
 foreach($schema in @('auth','vault')) {
  $sourceColumns=@($source.columns | Where-Object schema -eq $schema)
  $targetColumns=@($before.columns | Where-Object schema -eq $schema)
  if ((Normalize $sourceColumns) -ne (Normalize $targetColumns)) {throw "Managed $schema definitions differ; stop before import"}
 }
 $vaultSource=$source.extensions | Where-Object name -eq 'supabase_vault'
 $vaultTarget=$before.extensions | Where-Object name -eq 'supabase_vault'
 if ((Normalize $vaultSource) -ne (Normalize $vaultTarget)) {throw 'Vault extension mismatch'}
 $privilege=Invoke-GuardedNative -Executable $psql -Arguments @('-X','-h','127.0.0.1','-p','55452','-U',$restoreRole,'-d','postgres','--set','ON_ERROR_STOP=1','-A','-t','--command',"select has_parameter_privilege(current_user,'session_replication_role','SET')") -CaptureOutput
 if($privilege.ExitCode -ne 0 -or $privilege.StandardOutput.Trim() -ne 't'){throw 'Local restore role lacks required SET privilege; no import or privilege grant attempted'}
 if($ApprovedExistingLocalAdminRetry){'Separately approved local admin retry; never replay automatically' | Set-Content "$target/admin-retry-attempted.marker"}
 else{'Approved isolated restore attempt; never replay automatically' | Set-Content "$target/restore-attempted.marker"}
 if ((Get-Content "$backup/roles.sql" -Raw) -match 'cli_login_postgres') {throw 'Role export contains temporary CLI role operations; stop for review before import'}
 $env:PGOPTIONS=$null
 Invoke-Local @('--single-transaction','--file',"$backup/roles.sql",'--file',"$backup/schema.sql",'--command','SET session_replication_role = replica','--file',"$backup/data.sql") "$target/restore.log"
 # No Vault COPY: source is proven empty and protected tables may deny INSERT.
 $env:PGOPTIONS='-c default_transaction_read_only=on'
 $after=Read-Inventory 'inventory-after.json'
 $checks=[ordered]@{}
 $checks.auth_users_empty=($after.auth_users -eq 0)
 $checks.vault_secrets_empty=($after.vault_secrets -eq 0)
 $checks.no_hq_or_history=($after.hq_objects -eq 0 -and -not $after.history_exists)
 $checks.row_counts_equal=((Normalize @($source.counts)) -eq (Normalize @($after.counts)))
 $checks.browser_vault_denials_equal=((Normalize @($source.vault_browser_denials)) -eq (Normalize @($after.vault_browser_denials)))
 foreach($schema in @('auth','vault','public')) {
  $checks["${schema}_columns_equal"]=(Normalize @($source.columns | Where-Object schema -eq $schema)) -eq (Normalize @($after.columns | Where-Object schema -eq $schema))
  $checks["${schema}_owners_acls_rls_equal"]=(Normalize @($source.tables | Where-Object schema -eq $schema)) -eq (Normalize @($after.tables | Where-Object schema -eq $schema))
  $checks["${schema}_function_permissions_equal"]=(Normalize @($source.functions | Where-Object schema -eq $schema)) -eq (Normalize @($after.functions | Where-Object schema -eq $schema))
  foreach($kind in @('constraints','indexes','triggers')) {
   $checks["${schema}_${kind}_equal"]=(Normalize @($source.$kind | Where-Object schema -eq $schema)) -eq (Normalize @($after.$kind | Where-Object schema -eq $schema))
  }
 }
 foreach($name in @('anon','authenticated','service_role','postgres','supabase_auth_admin','supabase_admin')) {
  $checks["role_${name}_equal"]=(Normalize ($source.roles | Where-Object name -eq $name)) -eq (Normalize ($after.roles | Where-Object name -eq $name))
 }
 $checks.policies_equal=(Normalize @($source.policies)) -eq (Normalize @($after.policies))
 $appRoles=@('anon','authenticated','service_role','postgres','supabase_auth_admin','supabase_admin')
 $checks.relevant_memberships_equal=(Normalize @($source.memberships | Where-Object {$_.role -in $appRoles -and $_.member -in $appRoles})) -eq (Normalize @($after.memberships | Where-Object {$_.role -in $appRoles -and $_.member -in $appRoles}))
 $checks.default_privileges_equal=(Normalize @($source.default_privileges)) -eq (Normalize @($after.default_privileges))
 $checks.schema_permissions_equal=(Normalize @($source.schemas | Where-Object {$_.name -in @('public','auth','vault')})) -eq (Normalize @($after.schemas | Where-Object {$_.name -in @('public','auth','vault')}))
 $failures=@($checks.Keys | Where-Object {-not $checks[$_]})
 @{source_project=$manifest.project;target='firstrate-hq-restore-rehearsal';port=55452;verified_utc=[DateTime]::UtcNow.ToString('o');checks=$checks;pass=($failures.Count -eq 0);encrypted_round_trip=$true;vault_copy_skipped_proven_empty=$true;offsite_verified=$false;limitations=@('Zero-user source cannot prove restored login','Zero-secret source cannot prove encrypted-secret recovery','Managed memberships/platform differences need explicit review','Settings/keys/functions/storage bytes are outside SQL')} | ConvertTo-Json -Depth 12 | Set-Content "$target/restore-results.json"
 if ($failures.Count) {throw "Restore imported but verification differs: $($failures -join ', '). No blanket grants or resets applied."}
 Write-Output 'Baseline restore PASS; private evidence saved in .tooling/phase1-hosted-restore/restore-results.json.'
 Write-Output 'Portable encrypted off-site custody and future nonempty Auth/Vault recovery remain unverified.'
} finally {$env:PGPASSWORD=$savedPassword;$env:PGOPTIONS=$savedOptions;$login=$null;$status=$null}
