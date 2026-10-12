# Native stderr is a byte stream, not a PowerShell error record. Never echo raw
# CLI output: diagnostics may contain credentials, connection URLs or dump data.
function Invoke-GuardedNative {
 param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [string[]]$Arguments=@(),
  [switch]$CaptureOutput,
  [int]$TimeoutSeconds=900
 )
 $process=New-Object System.Diagnostics.Process
 $process.StartInfo.FileName=$Executable
 # Compatible with Windows PowerShell 5.1 (no ProcessStartInfo.ArgumentList).
 # All callers pass fixed flags/Windows paths, never credentials in arguments.
 $quoted=@(foreach($argument in $Arguments) {
  if ($argument.Contains('"')) {throw 'Unsupported native argument; no process started'}
  '"'+[regex]::Replace($argument,'(\\+)$','$1$1')+'"'
 })
 $process.StartInfo.Arguments=$quoted -join ' '
 $process.StartInfo.UseShellExecute=$false
 $process.StartInfo.CreateNoWindow=$true
 $process.StartInfo.RedirectStandardOutput=$true
 $process.StartInfo.RedirectStandardError=$true
 $stdout=$null;$stderr=$null;$started=$false
 try {
  try {$started=$process.Start()} catch {throw 'Native process could not start; raw diagnostics withheld'}
  if (-not $started) {throw 'Native process did not start'}
  # Drain both streams concurrently to avoid a full-pipe deadlock.
  $outputTask=$process.StandardOutput.ReadToEndAsync()
  $errorTask=$process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit($TimeoutSeconds*1000)) {
   $process.Kill();$process.WaitForExit()
   throw 'Native process timed out; partial output is not a valid backup'
  }
  $exitCode=$process.ExitCode
  $stdout=$outputTask.GetAwaiter().GetResult()
  $stderr=$errorTask.GetAwaiter().GetResult()
  $diagnostic='No sanitized diagnostic available'
  if ($stderr -match '(?i)password authentication failed|invalid password|authentication failed') {$diagnostic='Authentication failed; do not reset or create credentials'}
  elseif ($stderr -match '(?i)permission denied|insufficient privilege') {$diagnostic='Permission denied; stop for separate privilege approval'}
  elseif ($stderr -match '(?i)connection refused|no such host|network is unreachable|could not translate host|failed to connect|connect.*timed? out') {$diagnostic='Connection failed; no automatic credential or hosted-resource changes'}
  elseif ($stderr -match '(?i)docker.*(not running|unavailable|connect)|permission denied.*docker') {$diagnostic='Docker unavailable or inaccessible'}
  # The result contains no raw stderr. Stdout is opt-in for private local status
  # only; callers must assign it and never print or log credential-bearing JSON.
  return [pscustomobject]@{ExitCode=$exitCode;Diagnostic=$diagnostic;StandardOutput=$(if($CaptureOutput){$stdout}else{$null})}
 } finally {
  if ($started -and -not $process.HasExited) {$process.Kill();$process.WaitForExit()}
  $stdout=$null;$stderr=$null;$outputTask=$null;$errorTask=$null
  $process.Dispose()
 }
}
