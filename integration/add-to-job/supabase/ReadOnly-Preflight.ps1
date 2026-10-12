param([Parameter(Mandatory=$true)][string]$QueryFile,[Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Curl-ConfigTransport.ps1')
# Reuse the existing Windows CLI credential. Never mint roles, print tokens,
# put authorization in process arguments, or write authorization to disk.
if (-not ('HqStoredCliCredential' -as [type])) { Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class HqStoredCliCredential {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
 struct Credential { public uint Flags,Type; public string TargetName,Comment; public long LastWritten;
  public uint BlobSize; public IntPtr Blob; public uint Persist,AttributeCount;
  public IntPtr Attributes; public string Alias,UserName; }
 [DllImport("advapi32.dll",EntryPoint="CredReadW",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern bool Read(string target,uint type,uint flags,out IntPtr value);
 [DllImport("advapi32.dll")] static extern void CredFree(IntPtr value);
 public static string Token(string target) {
  IntPtr ptr;if(!Read(target,1,0,out ptr))return null;
  try {var c=(Credential)Marshal.PtrToStructure(ptr,typeof(Credential));
   var bytes=new byte[c.BlobSize];Marshal.Copy(c.Blob,bytes,0,bytes.Length);
   try {var token=Encoding.UTF8.GetString(bytes).TrimEnd('\0');
    if(token.StartsWith("sbp_"))return token;
    token=Encoding.Unicode.GetString(bytes).TrimEnd('\0');
    return token.StartsWith("sbp_")?token:null;
   }finally{Array.Clear(bytes,0,bytes.Length);}
  }finally{CredFree(ptr);}
 }
}
'@
}
$hqToken=$null
foreach($target in @('Supabase CLI:supabase','Supabase CLI:default','Supabase CLI:access-token')) {
 $hqToken=[HqStoredCliCredential]::Token($target);if($hqToken){break}
}
if(-not $hqToken){throw 'Existing CLI authorization was not found; stop for separate approval. Do not create credentials or paste tokens.'}
$hqToken=$hqToken.Trim()
$query=[IO.File]::ReadAllText([IO.Path]::GetFullPath($QueryFile))
# curl receives its Authorization header and SQL payload over stdin only.
$config=New-HqReadOnlyCurlConfig -Query $query -Token $hqToken
$process=New-Object System.Diagnostics.Process
$process.StartInfo.FileName=Join-Path $env:SystemRoot 'System32/curl.exe'
if(-not (Test-Path $process.StartInfo.FileName)){throw 'Expected Windows curl.exe is unavailable; stop for review'}
# Disable default curlrc loading: only this reviewed configuration may apply.
$process.StartInfo.Arguments='--disable --config -'
$process.StartInfo.UseShellExecute=$false;$process.StartInfo.CreateNoWindow=$true
$process.StartInfo.RedirectStandardInput=$true;$process.StartInfo.RedirectStandardOutput=$true
$process.StartInfo.RedirectStandardError=$true
try {
 Start-HqCurlWithoutBom -Process $process
 $resultTask=$process.StandardOutput.ReadToEndAsync();$errorTask=$process.StandardError.ReadToEndAsync()
 $process.StandardInput.Write($config);$process.StandardInput.Close()
 if(-not $process.WaitForExit(65000)){$process.Kill();throw 'Read-only metadata query timed out.'}
 $result=$resultTask.GetAwaiter().GetResult()
 $stderr=$errorTask.GetAwaiter().GetResult()
 $status='unavailable';if($result -match '(?s)\n(\d{3})\s*$'){$status=$Matches[1]}
 # This POST query endpoint returns 201 for successful read-only queries.
 # HTTP success is not a database mutation: read_only=true remains mandatory.
 if($process.ExitCode -ne 0 -or $status -notmatch '^2\d{2}$'){
  $diagnostic='response suppressed; no raw response or connection details logged'
  if($process.ExitCode -eq 2){$diagnostic='curl initialization/configuration failed before an HTTP result'}
  elseif($process.ExitCode -in @(5,6,7,28)){$diagnostic='DNS/proxy/connectivity or timeout failure'}
  elseif($process.ExitCode -in @(35,60)){$diagnostic='TLS/certificate validation failure; do not disable verification'}
  elseif($status -in @('401','403')){$diagnostic='existing authorization rejected; do not create or reset credentials'}
  throw "Read-only metadata query failed (curl $($process.ExitCode), HTTP $status): $diagnostic"
 }
 $result=$result.Substring(0,$result.LastIndexOf("`n"))
 # Persist only the SELECT result, never the request or credential.
 try {
  if([string]::IsNullOrWhiteSpace($result)){throw 'Empty result'}
  [void]($result|ConvertFrom-Json -ErrorAction Stop)
 }catch{throw 'Read-only metadata response was not valid JSON; body withheld'}
 [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputFile),$result)
 Write-Output 'Read-only metadata query succeeded; result saved.'
}finally{
 if($process.Id -and -not $process.HasExited){$process.Kill();$process.WaitForExit()}
 $hqToken=$null;$config=$null;$stderr=$null;$process.Dispose()
}
