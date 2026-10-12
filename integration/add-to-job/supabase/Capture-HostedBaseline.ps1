param([switch]$StartIsolatedTarget)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Invoke-GuardedNative.ps1')
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$backend=Join-Path $workspace 'integration/add-to-job'
$cli=Join-Path $workspace '.tooling/supabase/supabase.exe'
$project='ixtnmcrtgcyojqrthbhw'
$review=Join-Path $workspace '.tooling/phase1-hosted-review'
if ((git -C $workspace branch --show-current).Trim() -ne 'bubble-add') {throw 'Expected bubble-add'}
if ((Get-Content (Join-Path $PSScriptRoot '.temp/project-ref') -Raw).Trim() -ne $project) {throw 'Unexpected hosted link'}
if ((Get-FileHash $cli).Hash -ne '1CBEDD6E494581A1C1D90113660113A06798D9967D19C857127B66B8A428E836') {throw 'Unexpected CLI binary'}
$stamp=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$backupDir=Join-Path $workspace ".tooling/phase1-hosted-backups/$stamp"
if (Test-Path $backupDir) {throw 'Backup directory already exists; refusing reuse/overwrite'}
[void](New-Item -ItemType Directory -Path $backupDir)
# Restrict plaintext artifacts to this Windows user and SYSTEM. No cloud ACLs.
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$aclResult=Invoke-GuardedNative -Executable 'icacls.exe' -Arguments @($backupDir,'/inheritance:r','/grant:r',"${identity}:(OI)(CI)F",'SYSTEM:(OI)(CI)F')
if ($aclResult.ExitCode -ne 0) {throw "Cannot protect local backup directory (exit $($aclResult.ExitCode))"}
@{status='incomplete';project=$project;started_utc=[DateTime]::UtcNow.ToString('o');restore_allowed=$false} | ConvertTo-Json | Set-Content "$backupDir/capture-status.json"
$query=Join-Path $PSScriptRoot 'backup-baseline-inventory.sql'
& (Join-Path $PSScriptRoot 'ReadOnly-Preflight.ps1') -QueryFile $query -OutputFile "$backupDir/inventory-before.json"
$before=(Get-Content "$backupDir/inventory-before.json" -Raw | ConvertFrom-Json)[0].metadata
if ($before.read_only -ne 'on' -or $before.auth_users -ne 0 -or $before.vault_secrets -ne 0 -or $before.hq_objects -ne 0 -or $before.history_exists) {throw 'Source differs from reviewed empty baseline; stop for review'}
$secure=Read-Host 'Existing project database password (hidden; never reset)' -AsSecureString
if ($secure.Length -eq 0) {throw 'Existing password required; no dump invoked'}
$savedPassword=$env:SUPABASE_DB_PASSWORD;$savedProject=$env:SUPABASE_PROJECT_ID;$savedOptions=$env:PGOPTIONS
$ptr=[IntPtr]::Zero
try {
 $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
 $env:SUPABASE_DB_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
 $env:SUPABASE_PROJECT_ID=$project;$env:PGOPTIONS='-c default_transaction_read_only=on'
 $jobs=@(
  @{file='roles.sql';args=@('--role-only')},
  @{file='schema.sql';args=@()},
  @{file='data.sql';args=@('--data-only','--use-copy')},
  @{file='vault-data.sql';args=@('--schema','vault','--data-only','--use-copy')},
  @{file='managed-schema-reference.sql';args=@('--schema','auth,vault')}
 )
 foreach($job in $jobs) {
  $arguments=@('db','dump','--linked','--workdir',$backend,'--file',(Join-Path $backupDir $job.file))+$job.args
  Write-Output "Exporting $($job.file); raw CLI output remains private."
  $result=Invoke-GuardedNative -Executable $cli -Arguments $arguments
  @{file=$job.file;exit_code=$result.ExitCode;completed_utc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content (Join-Path $backupDir ($job.file+'.result.json'))
  if ($result.ExitCode -ne 0) {throw "Export failed: $($job.file) (exit $($result.ExitCode)). $($result.Diagnostic). Partial capture retained; do not restore it."}
  if (-not (Test-Path (Join-Path $backupDir $job.file)) -or (Get-Item -LiteralPath (Join-Path $backupDir $job.file)).Length -eq 0) {throw 'Export file missing or empty; incomplete capture retained'}
  Write-Output "Export completed: $($job.file) (exit 0)."
 }
} finally {
 $env:SUPABASE_DB_PASSWORD=$savedPassword;$env:SUPABASE_PROJECT_ID=$savedProject;$env:PGOPTIONS=$savedOptions
 if ($ptr -ne [IntPtr]::Zero) {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
 $secure.Dispose();$savedPassword=$null
}
& (Join-Path $PSScriptRoot 'ReadOnly-Preflight.ps1') -QueryFile $query -OutputFile "$backupDir/inventory-after.json"
$after=(Get-Content "$backupDir/inventory-after.json" -Raw | ConvertFrom-Json)[0].metadata
if (($before | ConvertTo-Json -Depth 30 -Compress) -ne ($after | ConvertTo-Json -Depth 30 -Compress)) {throw 'Source inventory changed during capture; do not accept this backup'}
foreach($name in @('settings.json','extra-settings.json','plan.json','file-manifest.json')) {
 Copy-Item -LiteralPath (Join-Path $review $name) -Destination (Join-Path $backupDir $name)
}
@{status='exports_complete';project=$project;completed_utc=[DateTime]::UtcNow.ToString('o');restore_allowed=$false} | ConvertTo-Json | Set-Content "$backupDir/capture-status.json"
$hashes=@(Get-ChildItem $backupDir -File | Sort-Object Name | ForEach-Object { @{file=$_.Name;sha256=(Get-FileHash $_.FullName).Hash} })
@{project=$project;captured_utc=[DateTime]::UtcNow.ToString('o');cli='2.120.0';files=$hashes;restore_verified=$false;offsite_verified=$false;encryption='Windows DPAPI CurrentUser; not portable by itself'} | ConvertTo-Json -Depth 8 | Set-Content "$backupDir/manifest.json"
Add-Type -AssemblyName System.Security
$archive="$backupDir/backup.zip"
$archiveFiles=@(Get-ChildItem $backupDir -File | Select-Object -ExpandProperty FullName)
Compress-Archive -LiteralPath $archiveFiles -DestinationPath $archive
$bytes=[IO.File]::ReadAllBytes($archive)
try {
 $encrypted=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 [IO.File]::WriteAllBytes("$backupDir/backup.dpapi",$encrypted)
}finally{[Array]::Clear($bytes,0,$bytes.Length);$encrypted=$null}
@{status='captured';project=$project;completed_utc=[DateTime]::UtcNow.ToString('o');restore_allowed=$true;offsite_verified=$false} | ConvertTo-Json | Set-Content "$backupDir/capture-complete.json"
# Keep protected plaintext working files for the approved restore. DPAPI is tied
# to this Windows user's keys: a portable encrypted off-site copy remains required.
Write-Output "Capture completed in $backupDir (private data; do not paste SQL)."
Write-Output 'DPAPI copy created. Restore and portable off-site recovery are NOT yet verified.'
if ($StartIsolatedTarget) {
 & (Join-Path $PSScriptRoot 'Prepare-IsolatedRestore.ps1')
}
