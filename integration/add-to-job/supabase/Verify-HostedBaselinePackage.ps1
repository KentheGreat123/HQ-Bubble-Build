param([Parameter(Mandatory=$true)][string]$BackupDirectory)
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$root=[IO.Path]::GetFullPath((Join-Path $workspace '.tooling/phase1-hosted-backups'))
$backup=[IO.Path]::GetFullPath($BackupDirectory)
if(-not $backup.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected backup root'}
$manifest=Get-Content "$backup/manifest.json" -Raw | ConvertFrom-Json
$complete=Get-Content "$backup/capture-complete.json" -Raw | ConvertFrom-Json
if($manifest.project -ne 'ixtnmcrtgcyojqrthbhw' -or $complete.status -ne 'captured' -or -not $complete.restore_allowed){throw 'Incomplete/wrong-project package'}
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.IO.Compression
$plain=$null;$archive=$null;$memory=$null;$sha=[Security.Cryptography.SHA256]::Create()
try {
 $plain=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes("$backup/backup.dpapi"),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 $zip=[IO.File]::ReadAllBytes("$backup/backup.zip")
 try {if([Convert]::ToBase64String($sha.ComputeHash($plain)) -ne [Convert]::ToBase64String($sha.ComputeHash($zip))){throw 'Encrypted archive round-trip mismatch'}}
 finally{[Array]::Clear($zip,0,$zip.Length)}
 $memory=New-Object IO.MemoryStream(,$plain)
 $archive=New-Object IO.Compression.ZipArchive($memory,[IO.Compression.ZipArchiveMode]::Read,$true)
 $expected=@($manifest.files.file)+@('manifest.json')
 if($archive.Entries.Count -ne $expected.Count){throw 'Unexpected archive entry count'}
 foreach($entry in $archive.Entries){if($entry.FullName -notin $expected){throw 'Unexpected archive entry'}}
 foreach($file in $manifest.files){
  if($file.file -ne [IO.Path]::GetFileName($file.file)){throw 'Invalid manifest entry'}
  if((Get-FileHash -LiteralPath (Join-Path $backup $file.file)).Hash -ne $file.sha256){throw 'Working backup checksum mismatch'}
  $entry=$archive.GetEntry($file.file);if(-not $entry){throw 'Archive entry missing'}
  $stream=$entry.Open()
  try {$digest=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','');if($digest -ne $file.sha256){throw 'Encrypted archive entry checksum mismatch'}}finally{$stream.Dispose()}
 }
 $entry=$archive.GetEntry('manifest.json');$reader=New-Object IO.StreamReader($entry.Open())
 try {$archivedManifest=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
 if(($manifest|ConvertTo-Json -Depth 20 -Compress) -ne ($archivedManifest|ConvertTo-Json -Depth 20 -Compress)){throw 'Archive manifest mismatch'}
 $before=(Get-Content "$backup/inventory-before.json" -Raw|ConvertFrom-Json)[0].metadata
 $after=(Get-Content "$backup/inventory-after.json" -Raw|ConvertFrom-Json)[0].metadata
 if(($before|ConvertTo-Json -Depth 30 -Compress) -ne ($after|ConvertTo-Json -Depth 30 -Compress)){throw 'Capture inventory changed'}
 if($after.read_only -ne 'on' -or $after.auth_users -ne 0 -or $after.vault_secrets -ne 0 -or $after.hq_objects -ne 0 -or $after.history_exists){throw 'Source differs from reviewed empty baseline'}
 foreach($file in @('roles.sql','schema.sql','data.sql','vault-data.sql','managed-schema-reference.sql')){
  $result=Get-Content (Join-Path $backup ($file+'.result.json')) -Raw|ConvertFrom-Json
  if($result.exit_code -ne 0 -or (Get-Item -LiteralPath (Join-Path $backup $file)).Length -eq 0){throw 'Export not successful/nonempty'}
 }
 [pscustomobject]@{pass=$true;manifest_files_verified=$manifest.files.Count;encrypted_archive_entries_verified=$archive.Entries.Count;all_five_exports_exit_zero=$true;source_inventory_stable=$true;auth_users=0;vault_secrets=0;portable_offsite_verified=$false}
}finally{
 if($archive){$archive.Dispose()};if($memory){$memory.Dispose()};if($plain){[Array]::Clear($plain,0,$plain.Length)};$sha.Dispose()
}
