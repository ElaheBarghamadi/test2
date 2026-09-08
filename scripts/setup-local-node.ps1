<#
.SYNOPSIS
  Installs a verified portable Node.js + npm runtime inside this repository.

.DESCRIPTION
  This script does not need administrator access and does not modify the
  system PATH, registry, or global npm installation. It downloads the official
  Node.js Windows archive to .tools, verifies its SHA-256 against nodejs.org,
  extracts it locally, and installs the lockfile dependencies with npm ci.
#>
[CmdletBinding()]
param(
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$NodeVersion = '22.14.0',
  [switch]$SkipDependencies
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ToolsRoot = Join-Path $ProjectRoot '.tools'
$DownloadsRoot = Join-Path $ToolsRoot 'downloads'
$architecture = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()) {
  'Arm64' { 'arm64' }
  'X64' { 'x64' }
  default { throw "Unsupported Windows architecture: $([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)." }
}

$archiveName = "node-v$NodeVersion-win-$architecture.zip"
$nodeDirectoryName = [System.IO.Path]::GetFileNameWithoutExtension($archiveName)
$nodeHome = Join-Path $ToolsRoot $nodeDirectoryName
$nodeExecutable = Join-Path $nodeHome 'node.exe'
$npmExecutable = Join-Path $nodeHome 'npm.cmd'
$baseUrl = "https://nodejs.org/dist/v$NodeVersion"
$archivePath = Join-Path $DownloadsRoot $archiveName

New-Item -ItemType Directory -Force -Path $ToolsRoot, $DownloadsRoot | Out-Null

if (-not (Test-Path $nodeExecutable)) {
  Write-Host "Downloading portable Node.js v$NodeVersion for Windows $architecture..." -ForegroundColor Cyan
  Invoke-WebRequest -Uri "$baseUrl/$archiveName" -OutFile $archivePath

  $checksums = (Invoke-WebRequest -Uri "$baseUrl/SHASUMS256.txt").Content
  $checksumLine = $checksums -split "`n" | Where-Object { $_ -match "\s$([regex]::Escape($archiveName))$" } | Select-Object -First 1
  if (-not $checksumLine) { throw "The official checksum for $archiveName was not found." }
  $expectedHash = ($checksumLine -split '\s+')[0].Trim().ToLowerInvariant()
  $actualHash = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expectedHash -ne $actualHash) {
    Remove-Item -Force $archivePath -ErrorAction SilentlyContinue
    throw 'Node.js archive checksum verification failed; the archive was removed.'
  }

  $temporaryExtract = Join-Path $ToolsRoot "extract-$([Guid]::NewGuid().ToString('N'))"
  try {
    Expand-Archive -Path $archivePath -DestinationPath $temporaryExtract -Force
    $extractedNodeHome = Join-Path $temporaryExtract $nodeDirectoryName
    if (-not (Test-Path (Join-Path $extractedNodeHome 'npm.cmd'))) { throw 'The downloaded Node.js archive has an unexpected structure.' }
    Remove-Item -Force -Recurse $nodeHome -ErrorAction SilentlyContinue
    Move-Item -Path $extractedNodeHome -Destination $nodeHome
  } finally {
    Remove-Item -Force -Recurse $temporaryExtract -ErrorAction SilentlyContinue
  }
  Remove-Item -Force $archivePath -ErrorAction SilentlyContinue
}

& $nodeExecutable --version
& $npmExecutable --version

if (-not $SkipDependencies) {
  Write-Host 'Installing locked frontend dependencies locally...' -ForegroundColor Cyan
  Push-Location $ProjectRoot
  try { & $npmExecutable ci } finally { Pop-Location }
}

Write-Host ''
Write-Host 'Ready. Node.js and npm are local to this repository.' -ForegroundColor Green
Write-Host 'Run the frontend with: .\scripts\dev-local.cmd'
