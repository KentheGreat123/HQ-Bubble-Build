$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../Curl-ConfigTransport.ps1')
$query=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../backup-baseline-inventory.sql'))
$config=New-HqReadOnlyCurlConfig -Query $query -Token 'sbp_SYNTHETICfixture'
if($config -notmatch 'read_only' -or $config -notmatch 'ixtnmcrtgcyojqrthbhw/database/query') {throw 'Read-only/project guard missing'}
$rejected=$false
try {[void](New-HqReadOnlyCurlConfig -Query $query -Token "sbp_fixture`nverbose")}catch{$rejected=$true}
if(-not $rejected){throw 'Credential configuration injection accepted'}
$savedEncoding=[Console]::InputEncoding
try {
 foreach($bom in @($true,$false)) {
  [Console]::InputEncoding=New-Object Text.UTF8Encoding($bom)
  $expectedPreamble=[Console]::InputEncoding.GetPreamble().Length
  $process=New-Object Diagnostics.Process
  $process.StartInfo.FileName=Join-Path $env:SystemRoot 'System32/curl.exe'
  # --version parses the configuration but makes no network request.
  $process.StartInfo.Arguments='--disable --config - --version'
  $process.StartInfo.UseShellExecute=$false;$process.StartInfo.CreateNoWindow=$true
  $process.StartInfo.RedirectStandardInput=$true;$process.StartInfo.RedirectStandardOutput=$true;$process.StartInfo.RedirectStandardError=$true
  try {
   Start-HqCurlWithoutBom -Process $process
   if([Console]::InputEncoding.GetPreamble().Length -ne $expectedPreamble){throw 'Caller encoding not restored'}
   $outputTask=$process.StandardOutput.ReadToEndAsync();$errorTask=$process.StandardError.ReadToEndAsync()
   $process.StandardInput.Write($config);$process.StandardInput.Close()
   if(-not $process.WaitForExit(15000)){throw 'Curl local parse timeout'}
   [void]$outputTask.GetAwaiter().GetResult();[void]$errorTask.GetAwaiter().GetResult()
   if($process.ExitCode -ne 0){throw 'Reviewed request config failed curl parsing'}
  }finally{$process.Dispose()}
 }
 Write-Output 'PASS: full request parses without network in both UTF-8 host modes; stdin has no BOM; host encoding restored; credential injection rejected.'
}finally{[Console]::InputEncoding=$savedEncoding;$config=$null}
