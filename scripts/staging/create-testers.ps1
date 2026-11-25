#Requires -Version 5.1
<#
.SYNOPSIS
  Creates the (at most 5) STAGING test accounts from a JSON file kept OUTSIDE the repository. Default is a dry run.
  Each account gets a verified email, an unknown random password and a one-time password-setup link printed to this terminal.
#>
[CmdletBinding()]
param([Parameter(Mandatory = $true)] [string]$File, [switch]$Apply)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Project = 'xploresoweto-staging'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
foreach ($name in 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT', 'FIREBASE_CONFIG', 'FIREBASE_AUTH_EMULATOR_HOST') { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
Push-Location (Join-Path $Repo 'functions')
try {
  if ($Apply) {
    $typed = Read-Host "This CREATES accounts in $Project. Type the project id to continue"
    if ($typed -cne $Project) { Write-Host 'BLOCKED: confirmation did not match.' -ForegroundColor Red; exit 1 }
    node scripts/create-testers.js --project $Project --file $File --apply
  } else {
    node scripts/create-testers.js --project $Project --file $File
  }
  if ($LASTEXITCODE -ne 0) { exit 1 }
} finally { Pop-Location }
