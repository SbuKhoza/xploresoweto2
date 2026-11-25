#Requires -Version 5.1
<#
.SYNOPSIS
  READ-ONLY inspection of a built APK: application id, signer (staging must not be debug-signed) and that its bundle names the expected
  project. Needs the Android build-tools (aapt, apksigner) on PATH. It does NOT prove where the app connects; see docs/staging/RUNBOOK.md.
.EXAMPLE
  .\scripts\staging\check-apk.ps1 -Apk .\android\app\build\outputs\apk\staging\release\app-staging-release.apk -Expect staging
#>
[CmdletBinding()]
param([Parameter(Mandatory = $true)] [string]$Apk, [Parameter(Mandatory = $true)] [ValidateSet('staging', 'production')] [string]$Expect)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$bad = @()
$ids = @{ staging = 'com.sbudamalloya.xploresoweto.staging'; production = 'com.sbudamalloya.xploresoweto' }
$project = @{ staging = 'xploresoweto-staging'; production = 'xploresoweto' }

$badging = & aapt dump badging $Apk | Select-String "^package: name='([^']+)'"
$appId = $badging.Matches[0].Groups[1].Value
if ($appId -cne $ids[$Expect]) { $bad += "application id is '$appId' (expected '$($ids[$Expect])')" }

$sig = & apksigner verify --print-certs $Apk 2>&1 | Out-String
if ($Expect -eq 'staging' -and $sig -match 'Android Debug') { $bad += 'the APK is signed with the Android DEBUG certificate' }

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("xs-apk-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($Apk, $tmp)
  $bundle = Get-ChildItem -Path (Join-Path $tmp 'assets') -Filter 'index.android.bundle' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $bundle) { $bad += 'no JavaScript bundle found in the APK' }
  else {
    $text = [System.IO.File]::ReadAllText($bundle.FullName, [System.Text.Encoding]::GetEncoding('ISO-8859-1'))
    # Both allow-list entries exist in every bundle by design, so this only proves the intended project is present in the bundle.
    # It is NOT proof of what the app connects to: that is the startup guard plus the network-capture test (docs/staging/RUNBOOK.md).
    if ($text -notmatch [regex]::Escape($project[$Expect])) { $bad += "the bundle does not mention $($project[$Expect])" }
  }
} finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }

if ($bad.Count -gt 0) { Write-Host 'APK CHECK FAILED:' -ForegroundColor Red; $bad | ForEach-Object { Write-Host "  - $_" }; exit 1 }
Write-Host "APK check passed for '$Expect' (application id $appId)." -ForegroundColor Green
