# Build the Windows installer locally: dist-electron\WriteMind-Setup-<version>.exe (per-user NSIS, x64).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-installer.ps1
#
#   -NoBuild        package the existing apps\desktop\out (after your own `npm run build`)
#   -Portable       also the portable .exe
#   -ShortcutName   a different Start menu / Desktop shortcut name, for a TEST installer that must not replace (and,
#                   when uninstalled, delete) the WriteMind.lnk shortcuts tools\setup-windows.ps1 made for a dev build
#
# Never publishes: releases are made by .github/workflows/release.yml from a pushed v<version> tag
# (docs/INSTALL-WINDOWS.md). Unsigned: there is no certificate yet.

param(
  [switch]$NoBuild,
  [switch]$Portable,
  [string]$ShortcutName = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is not installed: run install.cmd (tools\setup-windows.ps1) first." }

Set-Location $root
if (-not $NoBuild) {
  Write-Host "==> npm run build" -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "The build failed." }
}
if (-not (Test-Path (Join-Path $root "apps\desktop\out\main\main.mjs"))) { throw "No build in apps\desktop\out: run without -NoBuild." }

$targets = @("nsis")
if ($Portable) { $targets += "portable" }
$arguments = @("--win") + $targets + @("--x64", "--publish", "never", "--config", "electron-builder.yml")
if ($ShortcutName) { $arguments += "-c.nsis.shortcutName=$ShortcutName" }

# No certificate: do not go looking for one.
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
Write-Host "==> electron-builder $($arguments -join ' ')" -ForegroundColor Cyan
Push-Location (Join-Path $root "apps\desktop")
try {
  & (Join-Path $root "node_modules\.bin\electron-builder.cmd") @arguments
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed ($LASTEXITCODE)." }
} finally { Pop-Location }

Get-ChildItem (Join-Path $root "dist-electron") -Filter "*.exe" | Sort-Object LastWriteTime -Descending |
  Select-Object -First 2 | ForEach-Object { Write-Host ("    {0}  ({1:N1} MB)" -f $_.FullName, ($_.Length / 1MB)) -ForegroundColor Green }
