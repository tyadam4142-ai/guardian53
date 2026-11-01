param([Parameter(Mandatory=$true)][string]$ApiOrigin)
$ErrorActionPreference = 'Stop'
try { $Uri = [System.Uri]$ApiOrigin } catch { throw 'Enter a valid HTTPS origin.' }
if (-not $Uri.IsAbsoluteUri -or $Uri.Scheme -ne 'https' -or $Uri.AbsolutePath -ne '/' -or $Uri.Query -or $Uri.Fragment -or $Uri.UserInfo) {
  throw 'Pass an HTTPS origin only, e.g. https://guardian.example.com'
}
$Origin = $Uri.GetLeftPart([System.UriPartial]::Authority)
$Root = Split-Path -Parent $PSScriptRoot
$Extension = Join-Path $Root 'extension'
$Build = Join-Path $Root 'build'
$Stage = Join-Path $Build 'extension-configured'
New-Item -ItemType Directory -Force -Path $Build | Out-Null
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
Copy-Item -Path (Join-Path $Extension '*') -Destination $Stage -Recurse -Force
$Config = "// Generated for this packaged release.`nself.GUARDIAN_CONFIG = Object.freeze({ API_BASE_URL: '$Origin', POLICY_POLL_MINUTES: 1, EVENTS_POLL_MINUTES: 1, MAX_DYNAMIC_RULES: 4500 });`n"
Set-Content -Path (Join-Path $Stage 'config.js') -Value $Config -Encoding utf8
$ManifestPath = Join-Path $Stage 'manifest.json'
$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$Manifest.host_permissions = @('<all_urls>', $Origin + '/*')
$Manifest | ConvertTo-Json -Depth 20 | Set-Content $ManifestPath -Encoding utf8
$Zip = Join-Path $Build 'guardian53-extension.zip'
if (Test-Path $Zip) { Remove-Item $Zip }
Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $Zip
Write-Host "Created $Zip"
Write-Host 'The source extension/ directory was not modified.'
Write-Host 'Extract the ZIP and choose the extracted folder in chrome://extensions or edge://extensions.'
