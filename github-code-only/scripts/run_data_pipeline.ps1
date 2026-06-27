param(
  [switch]$SkipDatabase
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
$Python = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
  $Python = "python"
}

& $Python -c "import pandas, openpyxl" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Error "Python dependencies are missing. Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup_python_env.ps1"
  exit 1
}

Write-Host "Running standardized data pipeline..."
& $Python scripts\process_data.py --root "$Root"

if (-not $SkipDatabase) {
  Write-Host "Rebuilding SQLite database..."
  & $Python -c "from backend.db import ensure_database; print(ensure_database())"
}

$qualityPath = Join-Path $Root "output\data_quality_report.json"
if (Test-Path $qualityPath) {
  $quality = Get-Content $qualityPath -Raw -Encoding UTF8 | ConvertFrom-Json
  Write-Host "Quality issue summary:"
  $quality.issue_counts | Format-List
  Write-Host "Coordinate ranges:"
  $quality.coordinate_ranges | Format-List
}
