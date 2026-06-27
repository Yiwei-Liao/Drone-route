param(
  [int]$BackendPort = 8000,
  [int]$FrontendPort = 5173,
  [switch]$RunBrowser,
  [switch]$SkipBuild,
  [switch]$SkipPipeline
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Frontend = Join-Path $Root "frontend"
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$OutputDir = Join-Path $Root "output"
$PytestBaseTemp = Join-Path $OutputDir ("pytest-tmp-" + (Get-Date -Format "yyyyMMddHHmmss") + "-" + $PID)
$BrowserVerificationError = ""

Set-Location $Root

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Script
  )
  Write-Host ""
  Write-Host "== $Name =="
  $global:LASTEXITCODE = 0
  & $Script
  if ($LASTEXITCODE -ne 0) {
    throw "Step failed: $Name"
  }
}

function Invoke-NativeCommand {
  param([scriptblock]$Script)
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Script
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

function Test-JsonEndpoint {
  param(
    [string]$Url,
    [string]$Name
  )
  try {
    Invoke-RestMethod -Uri $Url -TimeoutSec 10 | Out-Null
    Write-Host "$Name OK: $Url"
  } catch {
    throw "$Name failed: $Url - $($_.Exception.Message)"
  }
}

function Get-ApiJson {
  param([string]$Url)
  return Invoke-RestMethod -Uri $Url -TimeoutSec 10
}

function Test-FileEvidence {
  param([string]$RelativePath)
  $path = Join-Path $Root $RelativePath
  $item = Get-Item $path -ErrorAction SilentlyContinue
  return [pscustomobject]@{
    path = $RelativePath
    exists = [bool]$item
    bytes = if ($item) { [int64]$item.Length } else { 0 }
  }
}

function Read-OptionalJsonFile {
  param([string]$RelativePath)
  $path = Join-Path $Root $RelativePath
  if (-not (Test-Path $path)) {
    return $null
  }
  return Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-NumberProperty {
  param(
    [object]$Object,
    [string]$Name
  )
  if ($null -eq $Object) {
    return 0
  }
  $prop = $Object.PSObject.Properties[$Name]
  if ($null -eq $prop -or $null -eq $prop.Value) {
    return 0
  }
  return [int]$prop.Value
}

function Get-ManifestProcessedNumber {
  param(
    [object]$Manifest,
    [string]$Role,
    [string]$Name
  )
  if ($null -eq $Manifest -or $null -eq $Manifest.processed_files) {
    return 0
  }
  $entry = @($Manifest.processed_files | Where-Object { $_.role -eq $Role } | Select-Object -First 1)
  if ($entry.Count -eq 0) {
    return 0
  }
  return Get-NumberProperty $entry[0] $Name
}

function New-VerificationGate {
  param(
    [string]$Name,
    [bool]$Passed,
    [object]$Expected,
    [object]$Actual
  )
  return [pscustomobject]@{
    name = $Name
    passed = $Passed
    expected = $Expected
    actual = $Actual
  }
}

function Write-VerificationReport {
  $backendBase = "http://127.0.0.1:$BackendPort"
  $frontendUrl = "http://127.0.0.1:$FrontendPort"
  $metrics = Get-ApiJson "$backendBase/api/metrics"
  $towers = Get-ApiJson "$backendBase/api/geojson/towers"
  $routes = Get-ApiJson "$backendBase/api/geojson/routes"
  $waypoints = Get-ApiJson "$backendBase/api/geojson/route_waypoints"
  $quality = Get-ApiJson "$backendBase/api/data-quality"
  $qualityIssues = Get-ApiJson "$backendBase/api/data-quality/issues"
  $backfillValidation = Get-ApiJson "$backendBase/api/data-quality/coordinate-backfill-validation-report"
  $manifest = Get-ApiJson "$backendBase/api/manifest"
  $mapVerification = Read-OptionalJsonFile "output\map_verification_report.json"

  $metricsCount = @($metrics).Count
  $towersCount = @($towers.features).Count
  $routesCount = @($routes.features).Count
  $waypointsCount = @($waypoints.features).Count
  $qualityIssueListCount = @($qualityIssues).Count
  $qualityIssueTotal = Get-NumberProperty $quality.issue_counts "total"
  $missingCoordinateIssueCount = Get-NumberProperty $quality.issue_counts.by_type "missing_coordinate"
  $validationRows = Get-NumberProperty $backfillValidation "rows"
  $validRows = Get-NumberProperty $backfillValidation "valid_rows"
  $pendingRows = Get-NumberProperty $backfillValidation "pending_rows"
  $incompleteRows = Get-NumberProperty $backfillValidation "incomplete_rows"
  $invalidNumericRows = Get-NumberProperty $backfillValidation "invalid_numeric_rows"
  $possibleSwappedRows = Get-NumberProperty $backfillValidation "possible_lon_lat_swapped_rows"
  $outOfRangeRows = Get-NumberProperty $backfillValidation "out_of_taian_range_rows"
  $classifiedBackfillRows = $validRows + $pendingRows + $incompleteRows + $invalidNumericRows + $possibleSwappedRows + $outOfRangeRows
  $manifestTowersCount = Get-NumberProperty $manifest.row_counts "towers"
  $manifestRoutesCount = Get-NumberProperty $manifest.row_counts "routes"
  $manifestWaypointsCount = Get-NumberProperty $manifest.row_counts "route_waypoints"
  $manifestTowerFeatures = Get-ManifestProcessedNumber $manifest "towers_geojson" "features"
  $manifestInputFiles = @($manifest.input_files)
  $manifestInputFilesWithHashes = @($manifestInputFiles | Where-Object { $_.sha256 -and $_.sha256.Length -eq 64 })

  $evidenceFiles = @(
    Test-FileEvidence "data\processed\manifest.json"
    Test-FileEvidence "data\processed\towers.csv"
    Test-FileEvidence "data\processed\routes.csv"
    Test-FileEvidence "data\processed\route_waypoints.csv"
    Test-FileEvidence "data\processed\data_quality_issues.csv"
    Test-FileEvidence "data\processed\coordinate_backfill_template.csv"
    Test-FileEvidence "data\processed\coordinate_backfill_validation.csv"
    Test-FileEvidence "output\data_quality_report.json"
    Test-FileEvidence "output\coordinate_backfill_validation_report.json"
    Test-FileEvidence "output\data_pipeline_log.json"
    Test-FileEvidence "output\map_verification_report.json"
    Test-FileEvidence "output\verified-map.png"
  )
  $requiredEvidenceFiles = @($evidenceFiles | Where-Object {
    if ($_.path -eq "output\verified-map.png" -or $_.path -eq "output\map_verification_report.json") {
      return [bool]$RunBrowser
    }
    return $true
  })
  $missingEvidenceFiles = @($requiredEvidenceFiles | Where-Object { -not $_.exists -or $_.bytes -le 0 })
  $mapVerificationStatus = if ($mapVerification) { $mapVerification.status } else { "missing" }

  $gates = @(
    New-VerificationGate "route metrics available" ($metricsCount -ge 1) "at least 1 route metric" $metricsCount
    New-VerificationGate "route metrics cover kml routes" ($metricsCount -ge $routesCount) "metrics count >= route count" "$metricsCount metrics / $routesCount routes"
    New-VerificationGate "tower coordinates available" ($towersCount -ge 100) "at least 100 valid tower coordinates" $towersCount
    New-VerificationGate "kml routes available" ($routesCount -ge 3) "at least 3 KML routes" $routesCount
    New-VerificationGate "route waypoints available" ($waypointsCount -ge 20) "at least 20 route waypoints" $waypointsCount
    New-VerificationGate "quality issue endpoint consistent" ($qualityIssueTotal -eq $qualityIssueListCount) "summary total equals issue list count" "$qualityIssueTotal summary / $qualityIssueListCount issues"
    New-VerificationGate "missing coordinate backfill rows match" ($missingCoordinateIssueCount -eq $validationRows) "missing-coordinate issues equal backfill validation rows" "$missingCoordinateIssueCount issues / $validationRows rows"
    New-VerificationGate "backfill validation rows classified" ($classifiedBackfillRows -eq $validationRows) "all backfill rows have a validation status" "$classifiedBackfillRows classified / $validationRows rows"
    New-VerificationGate "processing manifest generated" ($manifest.schema_version -eq "1.0") "manifest schema_version is 1.0" $manifest.schema_version
    New-VerificationGate "processing manifest input hashes available" ($manifestInputFiles.Count -ge 3 -and $manifestInputFilesWithHashes.Count -eq $manifestInputFiles.Count) "all manifest input files have sha256 hashes" "$($manifestInputFilesWithHashes.Count) hashed / $($manifestInputFiles.Count) inputs"
    New-VerificationGate "processing manifest row counts match api" ($manifestTowersCount -ge $towersCount -and $manifestTowerFeatures -eq $towersCount -and $manifestRoutesCount -eq $routesCount -and $manifestWaypointsCount -eq $waypointsCount) "manifest CSV row_counts and GeoJSON features match API counts" "manifest tower_csv/tower_geojson/routes/waypoints=$manifestTowersCount/$manifestTowerFeatures/$manifestRoutesCount/$manifestWaypointsCount; api towers/routes/waypoints=$towersCount/$routesCount/$waypointsCount"
    New-VerificationGate "required evidence files exist" ($missingEvidenceFiles.Count -eq 0) "all required evidence files exist and are non-empty" "$($missingEvidenceFiles.Count) missing or empty"
  )
  if ($RunBrowser) {
    $gates += New-VerificationGate "browser map verification passed" ($mapVerificationStatus -eq "passed" -and -not $BrowserVerificationError) "output/map_verification_report.json status is passed" "status=$mapVerificationStatus; error=$BrowserVerificationError"
  }
  $failedGates = @($gates | Where-Object { -not $_.passed })
  $status = if ($failedGates.Count -eq 0) { "passed" } else { "failed" }

  $report = [pscustomobject]@{
    generated_at = (Get-Date).ToString("s")
    status = $status
    run_browser = [bool]$RunBrowser
    skipped_build = [bool]$SkipBuild
    skipped_pipeline = [bool]$SkipPipeline
    python_executable = $Python
    frontend_url = $frontendUrl
    backend_url = $backendBase
    data_counts = [pscustomobject]@{
      metrics = $metricsCount
      towers = $towersCount
      routes = $routesCount
      route_waypoints = $waypointsCount
    }
    quality_issue_counts = $quality.issue_counts
    coordinate_backfill_validation = $backfillValidation
    manifest = $manifest
    map_verification = $mapVerification
    gates = $gates
    evidence_files = $evidenceFiles
  }

  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
  $reportPath = Join-Path $OutputDir "project_verification_report.json"
  $report | ConvertTo-Json -Depth 8 | Set-Content -Path $reportPath -Encoding UTF8
  Write-Host "Verification report: $reportPath"

  if ($failedGates.Count -gt 0) {
    $failedNames = ($failedGates | ForEach-Object { $_.name }) -join ", "
    throw "Verification gates failed: $failedNames"
  }
}

if (-not (Test-Path $Python)) {
  Invoke-Step "setup python environment" {
    powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\setup_python_env.ps1")
  }
}

Invoke-Step "verify python environment" {
  & $Python -c "import pandas, openpyxl, pytest, fastapi, uvicorn, multipart; print('Python environment OK')"
}

if (-not $SkipPipeline) {
  Invoke-Step "run data pipeline" {
    powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\run_data_pipeline.ps1")
  }
}

Invoke-Step "run python tests" {
  & $Python -m pytest tests --basetemp $PytestBaseTemp -p no:cacheprovider
}

if (-not $SkipBuild) {
Invoke-Step "build frontend" {
    Push-Location $Frontend
    try {
      Invoke-NativeCommand { npm.cmd run build }
    } finally {
      Pop-Location
    }
  }
}

Invoke-Step "start web services" {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\start_web.ps1") -BackendPort $BackendPort -FrontendPort $FrontendPort -SkipSetup -SkipPipeline
}

Invoke-Step "check backend endpoints" {
  Test-JsonEndpoint "http://127.0.0.1:$BackendPort/api/metrics" "metrics"
  Test-JsonEndpoint "http://127.0.0.1:$BackendPort/api/manifest" "processing manifest"
  Test-JsonEndpoint "http://127.0.0.1:$BackendPort/api/import/schema" "data import schema"
  Test-JsonEndpoint "http://127.0.0.1:$BackendPort/api/import/batches" "data import batches"
  Test-JsonEndpoint "http://127.0.0.1:$BackendPort/api/data-quality" "data quality"
  Test-JsonEndpoint "http://127.0.0.1:$BackendPort/api/data-quality/issues" "quality issues"
  Test-JsonEndpoint "http://127.0.0.1:$BackendPort/api/data-quality/coordinate-backfill-validation-report" "coordinate backfill validation"
}

Invoke-Step "check service status" {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\check_status.ps1") -BackendPort $BackendPort -FrontendPort $FrontendPort
}

if ($RunBrowser) {
  try {
    Invoke-Step "run browser map verification" {
      Push-Location $Frontend
      try {
        $env:FRONTEND_URL = "http://127.0.0.1:$FrontendPort"
        Invoke-NativeCommand { npm.cmd run verify:map }
      } finally {
        Remove-Item Env:\FRONTEND_URL -ErrorAction SilentlyContinue
        Pop-Location
      }
    }
  } catch {
    $BrowserVerificationError = $_.Exception.Message
    $global:LASTEXITCODE = 0
    Write-Host "Browser map verification failed; report writing will continue so gates capture the failure."
  }
} else {
  Write-Host ""
  Write-Host "Browser map verification skipped. Add -RunBrowser to run Playwright checks."
}

Invoke-Step "write verification report" {
  Write-VerificationReport
}

Write-Host ""
Write-Host "Project verification passed."
