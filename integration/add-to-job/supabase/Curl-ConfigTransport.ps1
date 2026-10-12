function New-HqReadOnlyCurlConfig {
 param([Parameter(Mandatory=$true)][string]$Query,[Parameter(Mandatory=$true)][string]$Token)
 # Prevent control characters/quotes from becoming curl configuration options.
 if ($Token -notmatch '^sbp_[A-Za-z0-9_-]+$') {throw 'Existing CLI credential format invalid; stop without creating or resetting credentials'}
 $payload=@{query=$Query;read_only=$true}|ConvertTo-Json -Compress
 # Credential-bearing string: assign it privately, never print or persist it.
 return 'url = "https://api.supabase.com/v1/projects/ixtnmcrtgcyojqrthbhw/database/query"'+"`n"+
  'request = "POST"'+"`n"+'header = "Content-Type: application/json"'+"`n"+
  'header = "Authorization: Bearer '+$Token+'"'+"`n"+
  'data = "'+$payload.Replace('\','\\').Replace('"','\"').Replace("`r",'\r').Replace("`n",'\n')+'"'+"`n"+
  'silent'+"`n"+'show-error'+"`n"+'fail-with-body'+"`n"+'write-out = "\n%{http_code}"'+"`n"+'connect-timeout = 15'+"`n"+'max-time = 60'+"`n"
}

function Start-HqCurlWithoutBom {
 param([Parameter(Mandatory=$true)][Diagnostics.Process]$Process)
 $encoding=New-Object Text.UTF8Encoding($false)
 if ($Process.StartInfo.PSObject.Properties.Name -contains 'StandardInputEncoding') {
  $Process.StartInfo.StandardInputEncoding=$encoding
  [void]$Process.Start()
 } else {
  # Windows PowerShell 5.1/.NET Framework lacks StandardInputEncoding. Process
  # initializes its auto-flushing stdin writer from Console.InputEncoding and
  # can emit a BOM during Start(), before even a BaseStream write. Choose a
  # BOM-free writer at creation; restore the caller's encoding immediately.
  $savedEncoding=[Console]::InputEncoding
  try {[Console]::InputEncoding=$encoding;[void]$Process.Start()}
  finally {[Console]::InputEncoding=$savedEncoding}
 }
 if ($Process.StandardInput.Encoding.CodePage -ne 65001 -or $Process.StandardInput.Encoding.GetPreamble().Length -ne 0) {
  throw 'Curl stdin must be UTF-8 without a BOM; request was not sent'
 }
}
