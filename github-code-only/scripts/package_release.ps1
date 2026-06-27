param(
  [string]$Version = "",
  [string]$PackageName = "taishan-uav-sandtable",
  [switch]$NoProcessedData,
  [switch]$IncludeRawData,
  [switch]$SkipReadinessCheck
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$ReleaseBase = Join-Path $Root "release"

if (-not $Version) {
  $versionPath = Join-Path $Root "VERSION"
  if (Test-Path $versionPath) {
    $Version = (Get-Content -LiteralPath $versionPath -Raw -Encoding UTF8).Trim()
  } else {
    $Version = "0.1.0"
  }
}

$ReleaseName = "$PackageName-v$Version"
$ReleaseRoot = Join-Path $ReleaseBase $ReleaseName
$MaterialsDir = Join-Path $ReleaseRoot "release_materials"

function Convert-ToRelativePath {
  param(
    [string]$BasePath,
    [string]$FullPath
  )
  $base = [System.IO.Path]::GetFullPath($BasePath).TrimEnd('\') + '\'
  $full = [System.IO.Path]::GetFullPath($FullPath)
  return $full.Substring($base.Length).Replace('\', '/')
}

function Test-ExcludedPath {
  param([string]$RelativePath)
  $normalized = $RelativePath.Replace('/', '\')
  $patterns = @(
    '(^|\\)\.git($|\\)',
    '(^|\\)\.venv($|\\)',
    '(^|\\)node_modules($|\\)',
    '(^|\\)frontend\\dist($|\\)',
    '(^|\\)\.pytest_cache($|\\)',
    '(^|\\)__pycache__($|\\)',
    '(^|\\)test-results($|\\)',
    '(^|\\)output\\runtime($|\\)',
    '(^|\\)output\\pytest-tmp',
    '(^|\\)release($|\\)',
    '(^|\\)frontend\\\.env(\.local)?$',
    '(^|\\)\.env(\.local)?$',
    '(^|\\)docs\\patents($|\\)',
    '(^|\\)docs\\ppt($|\\)',
    '(^|\\)docs\\report($|\\)'
  )
  foreach ($pattern in $patterns) {
    if ($normalized -match $pattern) {
      return $true
    }
  }
  if ($normalized -match '\.(doc|docx|ppt|pptx)$') {
    return $true
  }
  return $false
}

function Copy-FilteredTree {
  param(
    [string]$SourcePath,
    [string]$DestinationPath,
    [string[]]$AllowedExtensions = @()
  )
  if (-not (Test-Path -LiteralPath $SourcePath)) {
    return
  }
  $sourceFull = [System.IO.Path]::GetFullPath($SourcePath).TrimEnd('\')
  Get-ChildItem -LiteralPath $SourcePath -Recurse -Force -File -ErrorAction Stop | ForEach-Object {
    $relativeToSource = $_.FullName.Substring($sourceFull.Length).TrimStart('\')
    $relativeToRoot = Convert-ToRelativePath -BasePath $Root -FullPath $_.FullName
    if (Test-ExcludedPath $relativeToRoot) {
      return
    }
    if ($AllowedExtensions.Count -gt 0 -and $AllowedExtensions -notcontains $_.Extension.ToLowerInvariant()) {
      return
    }
    $destinationFile = Join-Path $DestinationPath $relativeToSource
    New-Item -ItemType Directory -Force -Path (Split-Path $destinationFile -Parent) | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $destinationFile -Force
  }
}

function Copy-RootFile {
  param([string]$RelativePath)
  $source = Join-Path $Root $RelativePath
  if (-not (Test-Path -LiteralPath $source)) {
    return
  }
  $destination = Join-Path $ReleaseRoot $RelativePath
  New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent) | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
}

if (-not $SkipReadinessCheck) {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\check_release_readiness.ps1")
}

New-Item -ItemType Directory -Force -Path $ReleaseBase | Out-Null
if (Test-Path -LiteralPath $ReleaseRoot) {
  $resolvedBase = [System.IO.Path]::GetFullPath($ReleaseBase).TrimEnd('\') + '\'
  $resolvedTarget = [System.IO.Path]::GetFullPath($ReleaseRoot).TrimEnd('\') + '\'
  if (-not $resolvedTarget.StartsWith($resolvedBase, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to delete release target outside release directory: $ReleaseRoot"
  }
  Remove-Item -LiteralPath $ReleaseRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $ReleaseRoot | Out-Null
New-Item -ItemType Directory -Force -Path $MaterialsDir | Out-Null

@("AGENTS.md", "README.md", "requirements.txt", "VERSION", ".gitignore") | ForEach-Object { Copy-RootFile $_ }
Copy-FilteredTree -SourcePath (Join-Path $Root "backend") -DestinationPath (Join-Path $ReleaseRoot "backend")
Copy-FilteredTree -SourcePath (Join-Path $Root "frontend") -DestinationPath (Join-Path $ReleaseRoot "frontend")
Copy-FilteredTree -SourcePath (Join-Path $Root "scripts") -DestinationPath (Join-Path $ReleaseRoot "scripts")
Copy-FilteredTree -SourcePath (Join-Path $Root "tests") -DestinationPath (Join-Path $ReleaseRoot "tests")
Copy-FilteredTree -SourcePath (Join-Path $Root "matlab") -DestinationPath (Join-Path $ReleaseRoot "matlab")
Copy-FilteredTree -SourcePath (Join-Path $Root "docs") -DestinationPath (Join-Path $ReleaseRoot "docs")

if (-not $NoProcessedData) {
  Copy-FilteredTree -SourcePath (Join-Path $Root "data\processed") -DestinationPath (Join-Path $ReleaseRoot "data\processed") -AllowedExtensions @(".csv", ".geojson", ".json")
}

if ($IncludeRawData) {
  Write-Warning "Including raw data. Confirm this is allowed before sharing the package."
  Copy-FilteredTree -SourcePath (Join-Path $Root "data\raw") -DestinationPath (Join-Path $ReleaseRoot "data\raw")
  Copy-FilteredTree -SourcePath (Join-Path $Root "raw") -DestinationPath (Join-Path $ReleaseRoot "raw")
}

$sourceExtensions = @(".py", ".ps1", ".m", ".js", ".jsx", ".css", ".html", ".json")
$listingPath = Join-Path $MaterialsDir "source_code_listing.txt"
$listingHeader = @(
  "Software: Taishan Low-altitude UAV Inspection 3D Sandtable Prototype",
  "Version: $Version",
  "Generated at: " + (Get-Date).ToString("s"),
  "Note: .env, node_modules, .venv, raw data, generated dist, and runtime logs are excluded.",
  ""
)
$listingHeader | Set-Content -LiteralPath $listingPath -Encoding UTF8

$sourceFiles = Get-ChildItem -LiteralPath $ReleaseRoot -Recurse -Force -File |
  Where-Object {
    $relative = Convert-ToRelativePath -BasePath $ReleaseRoot -FullPath $_.FullName
    ($sourceExtensions -contains $_.Extension.ToLowerInvariant()) -and
      ($relative -notmatch '^release_materials/') -and
      ($relative -notmatch '^data/processed/')
  } |
  Sort-Object FullName

$lineCount = 0
foreach ($file in $sourceFiles) {
  $relative = Convert-ToRelativePath -BasePath $ReleaseRoot -FullPath $file.FullName
  Add-Content -LiteralPath $listingPath -Encoding UTF8 -Value ""
  Add-Content -LiteralPath $listingPath -Encoding UTF8 -Value ("===== FILE: " + $relative + " =====")
  $lines = Get-Content -LiteralPath $file.FullName -Encoding UTF8
  $lineCount += @($lines).Count
  Add-Content -LiteralPath $listingPath -Encoding UTF8 -Value $lines
}

$files = Get-ChildItem -LiteralPath $ReleaseRoot -Recurse -Force -File | Sort-Object FullName
$manifestFiles = @()
foreach ($file in $files) {
  $relative = Convert-ToRelativePath -BasePath $ReleaseRoot -FullPath $file.FullName
  $manifestFiles += [pscustomobject]@{
    path = $relative
    bytes = [int64]$file.Length
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
  }
}

$manifest = [pscustomobject]@{
  package_name = $PackageName
  version = $Version
  generated_at = (Get-Date).ToString("s")
  include_processed_data = -not [bool]$NoProcessedData
  include_raw_data = [bool]$IncludeRawData
  source_file_count = @($sourceFiles).Count
  source_line_count = $lineCount
  excluded_by_default = @(".env", "frontend/.env", ".venv", "node_modules", "frontend/dist", "raw", "data/raw", "output/runtime")
  files = $manifestFiles
}
$manifestPath = Join-Path $ReleaseRoot "RELEASE_MANIFEST.json"
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$readmeRelease = @"
# Release Package

Package: $ReleaseName

This package is prepared for local review and software copyright application materials. It excludes local secrets, dependency folders, runtime logs, and raw data by default.

Run on Windows PowerShell:

```powershell
cd "$ReleaseName"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup_python_env.ps1
cd .\frontend
npm.cmd install
cd ..
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start_web.ps1
```

Open:

```text
http://127.0.0.1:5173
```

See `docs/user_manual.md`, `docs/release_checklist.md`, and `RELEASE_MANIFEST.json`.
"@
$readmeRelease | Set-Content -LiteralPath (Join-Path $MaterialsDir "README_RELEASE.md") -Encoding UTF8

$zipPath = Join-Path $ReleaseBase "$ReleaseName.zip"
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $ReleaseRoot "*") -DestinationPath $zipPath -Force

Write-Host "Release directory: $ReleaseRoot"
Write-Host "Release zip: $zipPath"
Write-Host "Source files: $(@($sourceFiles).Count)"
Write-Host "Source lines: $lineCount"
