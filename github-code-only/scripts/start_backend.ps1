param(
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
$Python = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
  $Python = "python"
}

& $Python -c "import fastapi, uvicorn, pandas, multipart" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Error "Python backend dependencies are missing. Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup_python_env.ps1"
  exit 1
}

Write-Host "Starting backend at http://127.0.0.1:$Port"
& $Python -m uvicorn backend.app:app --host 127.0.0.1 --port $Port
