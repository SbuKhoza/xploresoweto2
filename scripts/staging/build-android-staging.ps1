#Requires -Version 5.1
<#
.SYNOPSIS
  Builds the STAGING Android app locally (application id com.sbudamalloya.xploresoweto.staging). Needs the Android SDK and JDK.
.DESCRIPTION
  * Sets the staging EXPO_PUBLIC_* values for this process only (taken from config/environments.js) and refuses to continue while any
    staging identifier is still unknown.
  * Release builds need YOUR staging keystore through XS_STAGING_STORE_FILE, XS_STAGING_STORE_PASSWORD, XS_STAGING_KEY_ALIAS and
    XS_STAGING_KEY_PASSWORD (set them in this shell; the script never prints or stores them). There is no fallback to the debug key;
    Gradle itself also refuses (android/app/build.gradle).
.EXAMPLE
  .\scripts\staging\build-android-staging.ps1 -Variant Debug
  .\scripts\staging\build-android-staging.ps1 -Variant Release
#>
[CmdletBinding()]
param([ValidateSet('Debug', 'Release')] [string]$Variant = 'Release')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Repo
function Stop-Blocked([string]$Message) { Write-Host "BLOCKED: $Message" -ForegroundColor Red; exit 1 }
foreach ($tool in 'node') { if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Stop-Blocked "$tool is not installed or not on PATH" } }

# the staging environment must be fully configured, and the profile/flavor rules must agree
node scripts/verify-env.js staging
if ($LASTEXITCODE -ne 0) { Stop-Blocked 'the staging environment is not fully configured (see above)' }
$vars = node scripts/print-env.js staging | ConvertFrom-Json
foreach ($p in $vars.PSObject.Properties) { Set-Item -Path "Env:$($p.Name)" -Value $p.Value }

if ($Variant -eq 'Release') {
  foreach ($name in 'XS_STAGING_STORE_FILE', 'XS_STAGING_STORE_PASSWORD', 'XS_STAGING_KEY_ALIAS', 'XS_STAGING_KEY_PASSWORD') {
    if (-not (Get-Item "Env:$name" -ErrorAction SilentlyContinue)) { Stop-Blocked "$name is not set. A staging release is never signed with the debug key." }
  }
  $store = (Resolve-Path $env:XS_STAGING_STORE_FILE).Path
  if ($store.StartsWith($Repo, [System.StringComparison]::OrdinalIgnoreCase)) { Stop-Blocked 'the staging keystore must live OUTSIDE the repository' }
  if ((Split-Path $store -Leaf) -eq 'debug.keystore') { Stop-Blocked 'that is the debug keystore' }
}

Push-Location (Join-Path $Repo 'android')
try {
  & .\gradlew.bat ":app:assembleStaging$Variant"
  if ($LASTEXITCODE -ne 0) { Stop-Blocked 'the Gradle build failed (see above)' }
} finally { Pop-Location }
Write-Host "Built. Look under android\app\build\outputs\apk\staging\$($Variant.ToLower())\ ; check it with scripts\staging\check-apk.ps1" -ForegroundColor Green
