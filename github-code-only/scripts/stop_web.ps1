param(
  [int]$BackendPort = 8000,
  [int]$FrontendPort = 5173,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ports = @($BackendPort, $FrontendPort)
$connections = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue

if (-not $connections) {
  Write-Host "No web services are listening on ports $($ports -join ', ')."
  exit 0
}

$processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($processId in $processIds) {
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (-not $process) {
    continue
  }
  $listeningPorts = ($connections | Where-Object { $_.OwningProcess -eq $processId } | Select-Object -ExpandProperty LocalPort) -join ", "
  if ($DryRun) {
    Write-Host "Would stop PID $processId ($($process.ProcessName)) on ports $listeningPorts"
  } else {
    Write-Host "Stopping PID $processId ($($process.ProcessName)) on ports $listeningPorts"
    Stop-Process -Id $processId -Force
  }
}
