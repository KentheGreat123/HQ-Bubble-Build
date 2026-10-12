$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../Invoke-GuardedNative.ps1')
$node=(Get-Command node -ErrorAction Stop).Source
# Local synthetic processes only. No Supabase CLI, credential access or network.
foreach($exitCode in @(0,7)) {
 $code="process.stderr.write('Dumping roles from remote database...\nsecret-fixture-value\n');process.stdout.write('private-output-fixture');process.exit($exitCode)"
 $result=Invoke-GuardedNative -Executable $node -Arguments @('-e',$code) -TimeoutSeconds 15
 if ($result.ExitCode -ne $exitCode) {throw 'Native exit code lost'}
 if ($null -ne $result.StandardOutput) {throw 'Private stdout exposed by default'}
 if (($result | ConvertTo-Json) -match 'secret-fixture-value|private-output-fixture|Dumping roles') {throw 'Raw CLI output exposed'}
}
$result=Invoke-GuardedNative -Executable $node -Arguments @('-e',"process.stderr.write('password authentication failed for private-fixture');process.exit(9)") -TimeoutSeconds 15
if ($result.ExitCode -ne 9 -or $result.Diagnostic -notmatch '^Authentication failed') {throw 'Sanitized failure classification lost'}
if (($result | ConvertTo-Json) -match 'private-fixture') {throw 'Failure diagnostic leaked raw text'}
$result=Invoke-GuardedNative -Executable $node -Arguments @('-e',"process.stdout.write('local-status-fixture')") -CaptureOutput -TimeoutSeconds 15
if ($result.ExitCode -ne 0 -or $result.StandardOutput -ne 'local-status-fixture') {throw 'Opt-in private status capture failed'}
# Quoting preserves a path containing spaces and ending with a backslash.
$result=Invoke-GuardedNative -Executable $node -Arguments @('-e','process.stdout.write(process.argv[1])','C:\local fixture\') -CaptureOutput -TimeoutSeconds 15
if ($result.StandardOutput -ne 'C:\local fixture\') {throw 'Native argument quoting changed path'}
Write-Output 'PASS: stderr progress, nonzero exits, sanitized errors, private status capture, and Windows argument quoting.'
