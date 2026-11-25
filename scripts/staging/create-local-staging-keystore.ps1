#Requires -Version 5.1
<#
.SYNOPSIS
  OPTIONAL: creates a LOCAL staging release keystore (for builds on your own machine). The recommended route is an EAS-managed keystore
  (eas credentials, staging profile). Production signing is not involved. The keystore must live OUTSIDE the repository; back it up
  in your password manager: if you lose it, staging APK updates can no longer be installed over older ones.
#>
[CmdletBinding()]
param([Parameter(Mandatory = $true)] [string]$OutFile)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$full = [System.IO.Path]::GetFullPath($OutFile)
if ($full.StartsWith($Repo, [System.StringComparison]::OrdinalIgnoreCase)) { Write-Host 'BLOCKED: the keystore must be outside the repository.' -ForegroundColor Red; exit 1 }
if (Test-Path $full) { Write-Host 'BLOCKED: that file already exists; this script never overwrites a keystore.' -ForegroundColor Red; exit 1 }
if (-not (Get-Command keytool -ErrorAction SilentlyContinue)) { Write-Host 'BLOCKED: keytool (JDK) is not on PATH.' -ForegroundColor Red; exit 1 }
Write-Host 'keytool will ask for the keystore password, key password and your details. Choose strong passwords and store them safely.'
keytool -genkeypair -v -storetype PKCS12 -keystore $full -alias xploresoweto-staging -keyalg RSA -keysize 2048 -validity 10000
if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host "Created $full. In the shell that builds, set XS_STAGING_STORE_FILE, XS_STAGING_STORE_PASSWORD, XS_STAGING_KEY_ALIAS (xploresoweto-staging) and XS_STAGING_KEY_PASSWORD." -ForegroundColor Green
