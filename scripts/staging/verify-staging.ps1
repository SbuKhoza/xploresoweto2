#Requires -Version 5.1
<#
.SYNOPSIS
  READ-ONLY checks of the deployed staging project (needs the gcloud CLI signed in). Changes nothing.
  Verifies: 30 functions in africa-south1, none with a secret, each limited to 3 instances; Secret Manager holds no secrets.
#>
[CmdletBinding()] param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Project = 'xploresoweto-staging'
$bad = @()
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { Write-Host 'gcloud is not installed.' -ForegroundColor Red; exit 1 }

$fns = gcloud functions list --gen2 --regions africa-south1 --project $Project --format=json | ConvertFrom-Json
if ($fns.Count -ne 30) { $bad += "expected 30 functions, found $($fns.Count)" }
foreach ($f in $fns) {
  $cfg = $f.serviceConfig
  if ($cfg.maxInstanceCount -ne 3) { $bad += "$($f.name): maxInstanceCount=$($cfg.maxInstanceCount) (want 3)" }
  if ($cfg.PSObject.Properties.Name -contains 'secretEnvironmentVariables' -and $cfg.secretEnvironmentVariables) { $bad += "$($f.name): has a secret binding" }
}
$secrets = gcloud secrets list --project $Project --format=json | ConvertFrom-Json
if ($secrets -and @($secrets).Count -gt 0) { $bad += "Secret Manager in $Project is not empty ($(@($secrets).Count) secret(s)); it must be empty while Luna is disabled" }

if ($bad.Count -gt 0) { Write-Host 'VERIFY FAILED:' -ForegroundColor Red; $bad | ForEach-Object { Write-Host "  - $_" }; exit 1 }
Write-Host "Verified: $Project has 30 functions, none with a secret, all limited to 3 instances, and no secrets stored." -ForegroundColor Green
