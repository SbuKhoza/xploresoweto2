#Requires -Version 5.1
<#
.SYNOPSIS
  READ-ONLY checks of the deployed staging project.
  Verifies 41 active functions in africa-south1,
  each limited to 3 instances, with no secret bindings
  and no secrets stored in Secret Manager.
#>
[CmdletBinding()] param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Project = 'xploresoweto-staging'
$Region = 'africa-south1'
$bad = @()

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    throw 'gcloud is not installed.'
}

$raw = gcloud functions list --v2 `
    --regions=$Region `
    --project=$Project `
    --format=json

if ($LASTEXITCODE -ne 0) {
    throw 'Failed to list staging Cloud Functions.'
}

$fns = @((($raw -join "`n") | ConvertFrom-Json) | ForEach-Object { $_ })

if ($fns.Count -ne 41) {
    $bad += "Expected 41 functions, found $($fns.Count)"
}

foreach ($f in $fns) {
    if ($f.state -ne 'ACTIVE') {
        $bad += "$($f.name): function is not ACTIVE"
    }

    $cfg = $f.serviceConfig

    if ($cfg.maxInstanceCount -ne 3) {
        $bad += "$($f.name): maxInstanceCount is not 3"
    }

    foreach ($property in @(
        'secretEnvironmentVariables',
        'secretVolumes'
    )) {
        if (
            ($cfg.PSObject.Properties.Name -contains $property) `
            -and $cfg.$property
        ) {
            $bad += "$($f.name): has $property"
        }
    }
}

$rawSecrets = gcloud secrets list `
    --project=$Project `
    --format=json

if ($LASTEXITCODE -ne 0) {
    throw 'Failed to list staging secrets.'
}

$secrets = @((($rawSecrets -join "`n") | ConvertFrom-Json) | ForEach-Object { $_ })

if ($secrets.Count -gt 0) {
    $bad += "Secret Manager contains $($secrets.Count) secret(s)"
}

if ($bad.Count -gt 0) {
    Write-Host 'VERIFY FAILED:' -ForegroundColor Red

    $bad | ForEach-Object {
        Write-Host "  - $_"
    }

    exit 1
}

Write-Host "Verified: $Project" -ForegroundColor Green
Write-Host '41 active Cloud Functions'
Write-Host 'Maximum 3 instances per function'
Write-Host 'No secret bindings'
Write-Host 'No secrets stored'
Write-Host "Region: $Region"
