#Requires -Version 5.1
<#
.SYNOPSIS
  Writes SYNTHETIC test listings into xploresoweto-staging (and turns nothing on: Luna stays off). Default is a dry run.
  Uses Application Default Credentials:  gcloud auth application-default login
#>
[CmdletBinding()]
param([switch]$Apply)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Project = 'xploresoweto-staging'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
foreach ($name in 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT', 'FIREBASE_CONFIG', 'FIRESTORE_EMULATOR_HOST') { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
Push-Location (Join-Path $Repo 'functions')
try {
  if ($Apply) {
    $typed = Read-Host "This WRITES synthetic data to $Project. Type the project id to continue"
    if ($typed -cne $Project) { Write-Host 'BLOCKED: confirmation did not match.' -ForegroundColor Red; exit 1 }
    node scripts/seed-staging.js --project $Project --apply
  } else {
    node scripts/seed-staging.js --project $Project
  }
  if ($LASTEXITCODE -ne 0) { exit 1 }
} finally { Pop-Location }
