param(
  [int]$BackendPort = 8000,
  [int]$FrontendPort = 5173
)

$ErrorActionPreference = "Stop"

function Test-Url {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 5
    return [pscustomobject]@{
      Url = $Url
      Status = $response.StatusCode
      Ok = $true
    }
  } catch {
    return [pscustomobject]@{
      Url = $Url
      Status = $_.Exception.Message
      Ok = $false
    }
  }
}

$connections = Get-NetTCPConnection -LocalPort $BackendPort,$FrontendPort -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort, OwningProcess, @{Name="ProcessName"; Expression={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName}}

$backend = Test-Url "http://127.0.0.1:$BackendPort/api/metrics"
$importSchema = Test-Url "http://127.0.0.1:$BackendPort/api/import/schema"
$frontend = Test-Url "http://127.0.0.1:$FrontendPort"

$counts = $null
if ($backend.Ok) {
  try {
    $metrics = Invoke-RestMethod "http://127.0.0.1:$BackendPort/api/metrics" -TimeoutSec 5
    $towers = Invoke-RestMethod "http://127.0.0.1:$BackendPort/api/geojson/towers" -TimeoutSec 5
    $routes = Invoke-RestMethod "http://127.0.0.1:$BackendPort/api/geojson/routes" -TimeoutSec 5
    $waypoints = Invoke-RestMethod "http://127.0.0.1:$BackendPort/api/geojson/route_waypoints" -TimeoutSec 5
    $counts = [pscustomobject]@{
      Metrics = $metrics.Count
      Towers = $towers.features.Count
      Routes = $routes.features.Count
      Waypoints = $waypoints.features.Count
    }
  } catch {
    $counts = [pscustomobject]@{ Error = $_.Exception.Message }
  }
}

[pscustomobject]@{
  Backend = $backend
  ImportSchema = $importSchema
  Frontend = $frontend
  ListeningProcesses = $connections
  DataCounts = $counts
} | Format-List
