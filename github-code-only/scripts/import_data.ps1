param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("tasks", "ledger", "kml", "dem", "communication", "uav_models")]
  [string]$Category,

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
  "$BackendBase/api/import/files",
  "-F", "category=$Category"
)

if ($Note.Trim().Length -gt 0) {
  $curlArgs += @("-F", "note=$Note")
}

foreach ($item in $FilePath) {
  $resolved = Resolve-Path -LiteralPath $item -ErrorAction Stop
  $file = Get-Item -LiteralPath $resolved -ErrorAction Stop
  if (-not $file.PSIsContainer) {
    $curlArgs += @("-F", "files=@$($file.FullName)")
  }
}

Write-Host "Uploading files to staged import area..."
Write-Host "Category: $Category"
& curl.exe @curlArgs

if ($LASTEXITCODE -ne 0) {
  throw "Import upload failed."
}

Write-Host ""
Write-Host "Import staged. Review the returned batch_id before moving files into canonical data/raw folders."
