param(
  [int]$Port = 5173
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Frontend = Join-Path $Root "frontend"
Set-Location $Frontend

Write-Host "Starting frontend at http://127.0.0.1:$Port"
npm.cmd run dev -- --port $Port
