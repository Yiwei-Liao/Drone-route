param(
  [Parameter(Mandatory = $true)]
  [string[]]$FilePath,

  [int]$BackendPort = 8000,

  [string]$Note = ""
)

$ErrorActionPreference = "Stop"

function Test-Url {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 5
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

$BackendBase = "http://127.0.0.1:$BackendPort"
if (-not (Test-Url "$BackendBase/api/import/schema")) {
  Write-Error "Backend import API is not ready. Start it first: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start_web.ps1"
  exit 1
}

$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
if (-not $curl) {
  Write-Error "curl.exe is required for multipart upload on Windows."
  exit 1
}

$curlArgs = @(
  "-sS",
  "-f",
  "-X", "POST",
  "$BackendBase/api/import/kml-routes"
)

if ($Note.Trim().Length -gt 0) {
  $curlArgs += @("-F", "note=$Note")
}

foreach ($item in $FilePath) {
  $resolved = Resolve-Path -LiteralPath $item -ErrorAction Stop
  $file = Get-Item -LiteralPath $resolved -ErrorAction Stop
  if ($file.PSIsContainer) {
    continue
  }
  if ($file.Extension.ToLowerInvariant() -ne ".kml") {
    throw "Only .kml files can be added as active routes: $($file.FullName)"
  }
  $curlArgs += @("-F", "files=@$($file.FullName)")
}

Write-Host "Uploading KML files and rebuilding processed route data..."
& curl.exe @curlArgs

if ($LASTEXITCODE -ne 0) {
  throw "KML route import failed."
}

Write-Host ""
Write-Host "KML route import finished. Refresh the browser page if it is already open."
