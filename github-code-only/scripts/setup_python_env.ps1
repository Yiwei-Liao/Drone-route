param(
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$VenvDir = Join-Path $Root ".venv"
$Python = Join-Path $VenvDir "Scripts\python.exe"
$Requirements = Join-Path $Root "requirements.txt"

Set-Location $Root

if (-not (Test-Path $Python)) {
  Write-Host "Creating local Python virtual environment: $VenvDir"
  python -m venv "$VenvDir"
}

if (-not $SkipInstall) {
  Write-Host "Installing Python dependencies from requirements.txt..."
  & $Python -m pip install -r "$Requirements"
}

Write-Host "Verifying Python dependencies..."
& $Python -c "import pandas, openpyxl, pytest, fastapi, uvicorn, multipart; print('Python environment OK')"

Write-Host "Python executable: $Python"
