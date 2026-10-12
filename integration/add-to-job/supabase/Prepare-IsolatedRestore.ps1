$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Invoke-GuardedNative.ps1')
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$target=Join-Path $workspace '.tooling/phase1-hosted-restore'
$cli=Join-Path $workspace '.tooling/supabase/supabase.exe'
if (Test-Path $target) {throw 'Restore workspace already exists; refusing overwrite/reset'}
foreach($port in @(55450,55451,55452)) {
 if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {throw "Port $port is occupied"}
}
[void](New-Item -ItemType Directory -Path "$target/supabase")
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$aclResult=Invoke-GuardedNative -Executable 'icacls.exe' -Arguments @($target,'/inheritance:r','/grant:r',"${identity}:(OI)(CI)F",'SYSTEM:(OI)(CI)F')
if ($aclResult.ExitCode -ne 0) {throw 'Cannot protect isolated target directory'}
@'
project_id = "firstrate-hq-restore-rehearsal"
[api]
enabled = true
port = 55451
schemas = ["public"]
extra_search_path = ["public", "extensions"]
[db]
port = 55452
shadow_port = 55450
major_version = 17
[auth]
enabled = true
site_url = "http://localhost:55451"
enable_signup = false
enable_anonymous_sign_ins = false
[auth.email]
enable_signup = true
enable_confirmations = true
'@ | Set-Content "$target/supabase/config.toml"
if (Test-Path "$target/supabase/.temp/project-ref") {throw 'Local target must not be linked'}
# No HQ migrations, no reset, no function, no outbound mail/worker services.
$startResult=Invoke-GuardedNative -Executable $cli -Arguments @('start','--workdir',$target,'--exclude','storage-api,imgproxy,realtime,studio,postgres-meta,logflare,vector,supavisor,inbucket,edge-runtime')
@{exit_code=$startResult.ExitCode;diagnostic=$startResult.Diagnostic} | ConvertTo-Json | Set-Content "$target/start-result.json"
if ($startResult.ExitCode -ne 0) {throw "Isolated start failed (exit $($startResult.ExitCode)): $($startResult.Diagnostic). Do not reset any stack."}
$statusResult=Invoke-GuardedNative -Executable $cli -Arguments @('status','--workdir',$target,'--output','json') -CaptureOutput
if ($statusResult.ExitCode -ne 0) {throw "Local status failed (exit $($statusResult.ExitCode)); output withheld"}
$statusResult.StandardOutput | Set-Content "$target/status.json"
$statusResult=$null
$status=Get-Content "$target/status.json" -Raw | ConvertFrom-Json
if (([Uri]$status.DB_URL).Host -ne '127.0.0.1' -or ([Uri]$status.DB_URL).Port -ne 55452) {throw 'Unexpected target identity'}
Write-Output 'Isolated restore target ready on loopback DB port 55452; no restore performed yet.'
