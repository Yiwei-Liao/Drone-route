param(
  [int]$BackendPort = 8000,
  [int]$FrontendPort = 5173,
  [switch]$SkipSetup,
  [switch]$SkipPipeline
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Frontend = Join-Path $Root "frontend"
$RuntimeDir = Join-Path $Root "output\runtime"
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Database = Join-Path $Root "data\processed\inspection.sqlite"

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
Set-Location $Root

function Test-Url {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Wait-Url {
  param(
    [string]$Url,
    [string]$Name,
    [int]$Retries = 30
  )
  for ($index = 0; $index -lt $Retries; $index++) {
    if (Test-Url $Url) {
      Write-Host "$Name is ready: $Url"
      return $true
    }
    Start-Sleep -Seconds 1
  }
  Write-Warning "$Name did not become ready: $Url"
  return $false
}

if (-not $SkipSetup) {
  if (-not (Test-Path $Python)) {
    Write-Host "Python .venv not found; running setup..."
    powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\setup_python_env.ps1")
  } else {
    & $Python -c "import pandas, fastapi, uvicorn" 2>$null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Python dependencies are incomplete; running setup..."
      powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\setup_python_env.ps1")
    }
  }
}

if (-not (Test-Path (Join-Path $Frontend "node_modules"))) {
  Write-Error "Frontend dependencies are missing. Run: cd `"$Frontend`"; npm.cmd install"
  exit 1
}

if (-not $SkipPipeline -and -not (Test-Path $Database)) {
  Write-Host "Processed SQLite database not found; running data pipeline..."
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\run_data_pipeline.ps1")
}

$BackendUrl = "http://127.0.0.1:$BackendPort/api/metrics"
$FrontendUrl = "http://127.0.0.1:$FrontendPort"

if (Test-Url $BackendUrl) {
  Write-Host "Backend already running: $BackendUrl"
} else {
  Write-Host "Starting backend..."
  Start-Process `
    -FilePath "powershell" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\start_backend.ps1", "-Port", "$BackendPort") `
    -WorkingDirectory "$Root" `
    -RedirectStandardOutput (Join-Path $RuntimeDir "backend.out.log") `
    -RedirectStandardError (Join-Path $RuntimeDir "backend.err.log") `
    -WindowStyle Hidden | Out-Null
}

if (Test-Url $FrontendUrl) {
  Write-Host "Frontend already running: $FrontendUrl"
} else {
  Write-Host "Starting frontend..."
  Start-Process `
    -FilePath "powershell" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\start_frontend.ps1", "-Port", "$FrontendPort") `
    -WorkingDirectory "$Root" `
    -RedirectStandardOutput (Join-Path $RuntimeDir "frontend.out.log") `
    -RedirectStandardError (Join-Path $RuntimeDir "frontend.err.log") `
    -WindowStyle Hidden | Out-Null
}

$backendOk = Wait-Url $BackendUrl "Backend"
$frontendOk = Wait-Url $FrontendUrl "Frontend"

powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\check_status.ps1") -BackendPort $BackendPort -FrontendPort $FrontendPort

if (-not ($backendOk -and $frontendOk)) {
  Write-Warning "Startup was not fully healthy. Check logs in: $RuntimeDir"
  exit 1
}

Write-Host "Web prototype is ready:"
Write-Host "- Frontend: $FrontendUrl"
Write-Host "- Backend API: http://127.0.0.1:$BackendPort"
Write-Host "- Logs: $RuntimeDir"
