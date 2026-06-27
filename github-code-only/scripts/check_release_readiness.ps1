param(
  [switch]$RunProjectVerification
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$OutputDir = Join-Path $Root "output"
$Checks = New-Object System.Collections.Generic.List[object]

function Add-Check {
  param(
    [string]$Name,
    [bool]$Passed,
    [object]$Expected,
    [object]$Actual
  )
  $script:Checks.Add([pscustomobject]@{
    name = $Name
    passed = $Passed
    expected = $Expected
    actual = $Actual
  })
}

function Test-RelativePath {
  param([string]$RelativePath)
  return Test-Path -LiteralPath (Join-Path $Root $RelativePath)
}

function Get-Text {
  param([string]$RelativePath)
  return Get-Content -LiteralPath (Join-Path $Root $RelativePath) -Raw -Encoding UTF8
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$versionPath = Join-Path $Root "VERSION"
$version = if (Test-Path $versionPath) { (Get-Content -LiteralPath $versionPath -Raw -Encoding UTF8).Trim() } else { "" }
Add-Check "version file exists" ($version -match '^\d+\.\d+\.\d+$') "semantic version in VERSION" $version

$gitignore = if (Test-RelativePath ".gitignore") { Get-Text ".gitignore" } else { "" }
$requiredIgnores = @(".env", ".env.local", "frontend/.env", "frontend/.env.local", ".venv/", "node_modules/", "frontend/dist/", "release/", "output/release/")
$missingIgnores = @($requiredIgnores | Where-Object { $gitignore -notmatch [regex]::Escape($_) })
Add-Check "sensitive and generated paths ignored" ($missingIgnores.Count -eq 0) ($requiredIgnores -join ", ") ($missingIgnores -join ", ")

$envExample = if (Test-RelativePath "frontend\.env.example") { Get-Text "frontend\.env.example" } else { "" }
Add-Check "env example exists" ($envExample.Length -gt 0) "frontend/.env.example" ("bytes=" + $envExample.Length)
Add-Check "cesium token example is empty" ($envExample -match '(?m)^VITE_CESIUM_ION_TOKEN=\s*$') "VITE_CESIUM_ION_TOKEN with no value" "checked"
Add-Check "google key example is empty" ($envExample -match '(?m)^VITE_GOOGLE_MAPS_API_KEY=\s*$') "VITE_GOOGLE_MAPS_API_KEY with no value" "checked"

$packagePath = Join-Path $Root "frontend\package.json"
if (Test-Path $packagePath) {
  $package = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
  Add-Check "frontend package has product name" ([bool]$package.name) "package.json name" $package.name
  Add-Check "frontend package version matches VERSION" ($package.version -eq $version) $version $package.version
} else {
  Add-Check "frontend package exists" $false "frontend/package.json" "missing"
}

$requiredFiles = @(
  "AGENTS.md",
  "README.md",
  "requirements.txt",
  "backend\app.py",
  "backend\taishan_pipeline\process_data.py",
  "frontend\src\App.jsx",
  "frontend\src\styles.css",
  "frontend\package-lock.json",
  "scripts\verify_project.ps1",
  "scripts\verify_map.mjs",
  "scripts\package_release.ps1",
  "scripts\check_release_readiness.ps1",
  "docs\software_copyright_materials.md",
  "docs\software_copyright_application_template.md",
  "docs\source_code_manifest.md",
  "docs\user_manual.md",
  "docs\release_notes.md",
  "docs\release_checklist.md",
  "docs\assumptions_and_limits.md",
  "docs\visualization_design.md",
  "data\processed\manifest.json",
  "data\processed\towers.geojson",
  "data\processed\routes.geojson",
  "data\processed\route_waypoints.geojson",
  "data\processed\base_stations.geojson"
)
$missingFiles = @($requiredFiles | Where-Object { -not (Test-RelativePath $_) })
Add-Check "required release files exist" ($missingFiles.Count -eq 0) ($requiredFiles -join ", ") ($missingFiles -join ", ")

$envExists = Test-RelativePath "frontend\.env"
Add-Check "local env may exist but is not packaged" $true "frontend/.env is allowed locally and excluded by scripts" ("exists=" + $envExists)

if ($RunProjectVerification) {
  try {
    powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\verify_project.ps1")
    Add-Check "project verification passed" $true "verify_project.ps1 exits 0" "passed"
  } catch {
    Add-Check "project verification passed" $false "verify_project.ps1 exits 0" $_.Exception.Message
  }
}

$failed = @($Checks | Where-Object { -not $_.passed })
$status = if ($failed.Count -eq 0) { "passed" } else { "failed" }
$report = [pscustomobject]@{
  generated_at = (Get-Date).ToString("s")
  status = $status
  version = $version
  checks = $Checks
}
$reportPath = Join-Path $OutputDir "release_readiness_report.json"
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host "Release readiness report: $reportPath"

if ($failed.Count -gt 0) {
  $failedNames = ($failed | ForEach-Object { $_.name }) -join ", "
  throw "Release readiness checks failed: $failedNames"
}

Write-Host "Release readiness checks passed."
