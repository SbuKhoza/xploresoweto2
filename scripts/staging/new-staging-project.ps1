#Requires -Version 5.1
<#
.SYNOPSIS
  Creates the STAGING Firebase/Google Cloud project xploresoweto-staging. DEFAULT IS A PLAN ONLY: it prints every command and runs none.
.DESCRIPTION
  Requires separate owner approval (it creates cloud resources and links billing). It never touches the production project.
  With -Execute it asks you to type the project id, then runs the commands one by one, stopping at the first failure.
  -BillingAccountId is the id shown by:  gcloud billing accounts list
  The monthly budget is an ALERT threshold, not a spending cap.
.EXAMPLE
  .\scripts\staging\new-staging-project.ps1 -BillingAccountId 000000-AAAAAA-BBBBBB            (plan only)
  .\scripts\staging\new-staging-project.ps1 -BillingAccountId 000000-AAAAAA-BBBBBB -Execute
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [ValidatePattern('^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$')] [string]$BillingAccountId,
  [ValidateRange(5, 200)] [int]$BudgetUsd = 20,
  [switch]$Execute
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Project = 'xploresoweto-staging'
$Region = 'africa-south1'
$Apis = 'firestore.googleapis.com', 'cloudfunctions.googleapis.com', 'run.googleapis.com', 'cloudbuild.googleapis.com', 'artifactregistry.googleapis.com', 'eventarc.googleapis.com', 'identitytoolkit.googleapis.com', 'firebaserules.googleapis.com', 'firebasestorage.googleapis.com', 'secretmanager.googleapis.com'

$steps = @(
  "gcloud projects create $Project --name=`"XploreSoweto Staging`"",
  "gcloud billing projects link $Project --billing-account=$BillingAccountId",
  "gcloud beta billing budgets create --billing-account=$BillingAccountId --display-name=`"xploresoweto-staging alert`" --budget-amount=${BudgetUsd}USD --filter-projects=projects/$Project --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0",
  "firebase projects:addfirebase $Project",
  "gcloud services enable $($Apis -join ' ') --project=$Project",
  "gcloud firestore databases create --database=`"(default)`" --location=$Region --type=firestore-native --project=$Project",
  "firebase apps:create WEB `"XploreSoweto Staging Web`" --project $Project",
  "firebase apps:create ANDROID `"XploreSoweto Staging`" --package-name com.sbudamalloya.xploresoweto.staging --project $Project"
)
Write-Host "Plan for project $Project (billing account $BillingAccountId, budget alert USD $BudgetUsd):" -ForegroundColor Cyan
$steps | ForEach-Object { Write-Host "  $_" }
Write-Host ''
Write-Host 'Console-only steps afterwards: enable Authentication > Email/Password only; create the default Storage bucket in africa-south1;' 
Write-Host 'then copy the web app config into config/environments.js (see docs/staging/RUNBOOK.md).'
if (-not $Execute) { Write-Host 'PLAN ONLY: nothing was run. Add -Execute to run it.' -ForegroundColor Green; exit 0 }

$typed = Read-Host "This creates cloud resources and links billing. Type the project id ($Project) to continue"
if ($typed -cne $Project) { Write-Host 'BLOCKED: confirmation did not match.' -ForegroundColor Red; exit 1 }
foreach ($step in $steps) {
  Write-Host ">> $step" -ForegroundColor Yellow
  Invoke-Expression $step
  if ($LASTEXITCODE -ne 0) { Write-Host "STOPPED: the step above failed (exit $LASTEXITCODE). Nothing further was run." -ForegroundColor Red; exit 1 }
}
Write-Host 'Project created. Continue with the console-only steps above.' -ForegroundColor Green
