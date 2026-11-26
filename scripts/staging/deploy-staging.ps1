#Requires -Version 5.1
<#
.SYNOPSIS
  Deploys the XploreSoweto STAGING backend (rules, indexes, functions) to the project xploresoweto-staging. Nothing else.
.DESCRIPTION
  * The project id is a literal below. There is NO parameter that changes it and the script never relies on .firebaserc aliases,
    `firebase use`, or any project left in your shell: every firebase command carries --project explicitly.
  * Refuses unless you are on a staging/* branch with a clean working tree (scripts/staging/guard.js).
  * Clears ambient project variables, then pins GCLOUD_PROJECT to the staging project for THIS process only.
  * For functions it first generates the manifest OFFLINE and checks: 41 functions, no secret bound, max 3 instances.
  * Asks you to type the project id before deploying. Never uses --force. No secret is read or set.
.EXAMPLE
  .\scripts\staging\deploy-staging.ps1 -What rules -DryRun
  .\scripts\staging\deploy-staging.ps1 -What all
#>
[CmdletBinding()]
param(
  [ValidateSet('rules', 'functions', 'all')] [string]$What = 'all',
  [switch]$DryRun
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Project = 'xploresoweto-staging'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Repo

function Stop-Blocked([string]$Message) { Write-Host "BLOCKED: $Message" -ForegroundColor Red; exit 1 }
foreach ($tool in 'node', 'git', 'firebase') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Stop-Blocked "$tool is not installed or not on PATH" }
}

# 1. Branch, clean tree and exact project (decided in Node so it is unit-tested)
node scripts/staging/guard.js deploy $Project
if ($LASTEXITCODE -ne 0) { Stop-Blocked 'the deploy guard refused (see above)' }

# 2. Nothing in the shell may redirect this deploy
foreach ($name in 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT', 'FIREBASE_CONFIG', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST') {
  Remove-Item "Env:$name" -ErrorAction SilentlyContinue
}
# no provider or other API key may ride along into the functions analysis (staging has none)
Get-ChildItem Env: | Where-Object { $_.Name -match '(_API_KEY|_SECRET)$' } | ForEach-Object { Remove-Item "Env:$($_.Name)" -ErrorAction SilentlyContinue }
if ($env:GOOGLE_APPLICATION_CREDENTIALS) { Write-Host 'Note: GOOGLE_APPLICATION_CREDENTIALS is set; make sure it is NOT a production service account.' -ForegroundColor Yellow }
$env:GCLOUD_PROJECT = $Project

# 3. Offline manifest check for functions
if ($What -ne 'rules') {
  Push-Location (Join-Path $Repo 'functions')
  try { node scripts/check-manifest.js; $rc = $LASTEXITCODE } finally { Pop-Location }
  if ($rc -ne 0) { Stop-Blocked 'the offline function manifest check failed' }
}

# 4. What will be deployed
$only = switch ($What) {
  'rules'     { 'firestore:rules,firestore:indexes,storage' }
  'functions' { 'functions' }
  'all'       { 'firestore:rules,firestore:indexes,storage,functions' }
}
$fbArgs = @('deploy', '--only', $only, '--project', $Project)
Write-Host ''
Write-Host "Target project : $Project (africa-south1)"
Write-Host "Deploying      : $only"
Write-Host "Command        : firebase $($fbArgs -join ' ')"
if ($DryRun) { Write-Host 'DRY RUN: nothing was deployed.' -ForegroundColor Green; exit 0 }

# 5. Typed confirmation, then deploy
$typed = Read-Host "Type the project id ($Project) to deploy"
if ($typed -cne $Project) { Stop-Blocked 'confirmation did not match; nothing was deployed' }
& firebase @fbArgs
if ($LASTEXITCODE -ne 0) { Stop-Blocked 'firebase deploy failed (see above)' }
Write-Host 'Deployed. Now run .\scripts\staging\verify-staging.ps1' -ForegroundColor Green
