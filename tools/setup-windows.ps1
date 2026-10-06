# Set up WriteMind on a Windows machine from a fresh clone or download.
#
#   Double-click install.cmd in the repo's root, or:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\setup-windows.ps1
#
# It installs Node.js if the machine has none, installs the packages, builds
# the app, and puts a WriteMind shortcut on the Desktop and in the Start
# menu. Nothing is installed system-wide except Node (through winget) and
# nothing outside this folder is touched apart from the two shortcuts.
#
#   -Package      also build the Windows installer (dist-electron\*.exe)
#   -NoShortcut   skip the Desktop / Start menu shortcuts
#   -DryRun       say what would happen and change nothing
#   -ShortcutsOnly  just (re)make the shortcuts for an existing build

param(
  [switch]$Package,
  [switch]$NoShortcut,
  [switch]$DryRun,
  [switch]$ShortcutsOnly
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Run($label, [scriptblock]$block) {
  if ($DryRun) { Write-Host "    (dry run) $label"; return }
  & $block
}
function RefreshPath {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [Environment]::GetEnvironmentVariable("Path", "User")
}

if ($env:OS -ne "Windows_NT") { throw "This script is for Windows. On macOS or Linux see docs\BUILDING.md." }
if (-not (Test-Path (Join-Path $root "package.json"))) { throw "Run this from the WriteMind repo." }

$electron = Join-Path $root "node_moduleselectrondistelectron.exe"
if (-not $ShortcutsOnly) {
# 1. Node.js ---------------------------------------------------------------
Step "Checking Node.js"
RefreshPath
$node = Get-Command node -ErrorAction SilentlyContinue
$major = 0
if ($node) { $major = [int](((& node -v).TrimStart("v")).Split(".")[0]) }
if ($major -lt 20) {
  if ($node) { Write-Host "    Node $major is too old (need 20 or newer)." }
  else { Write-Host "    Node.js is not installed." }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget is not available. Install Node.js LTS from https://nodejs.org and run this again."
  }
  Run "winget install OpenJS.NodeJS.LTS" {
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    RefreshPath
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
      throw "Node.js installed but is not on PATH yet. Close this window, open a new one, and run this again."
    }
  }
} else {
  Write-Host "    Node $major found."
}

# 2. Packages --------------------------------------------------------------
Step "Installing packages (npm ci)"
Run "npm ci" {
  if (Test-Path (Join-Path $root "package-lock.json")) { npm ci } else { npm install }
  if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
}

# npm skips Electron's own download script on recent versions, so do it by hand.
Step "Fetching the Electron runtime"
$electron = Join-Path $root "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electron)) {
  Run "node node_modules\electron\install.js" {
    node (Join-Path $root "node_modules\electron\install.js")
    if (-not (Test-Path $electron)) { throw "Electron did not download. Check the network and run this again." }
  }
} else {
  Write-Host "    Already there."
}

# 3. Build -----------------------------------------------------------------
Step "Building WriteMind"
Run "npm run build" {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "The build failed." }
}

if ($Package) {
  Step "Building the Windows installer"
  Run "npm -w @writemind/desktop run package:win" {
    npm -w "@writemind/desktop" run package:win
    if ($LASTEXITCODE -ne 0) { throw "Packaging failed." }
    Write-Host "    Installer is in dist-electron\"
  }
}

}

# 4. Shortcuts -------------------------------------------------------------
if (-not $NoShortcut) {
  if (-not (Test-Path $electron) -and -not $DryRun) { throw "No build here yet: run install.cmd first." }
  Step "Creating shortcuts"
  Run "Desktop and Start menu shortcuts" {
    # A shortcut wants an .ico; make one from the PNG (a PNG inside an ICO
    # container is valid from Windows Vista on).
    $iconPath = Join-Path $root "packaging\writemind.ico"
    Add-Type -AssemblyName System.Drawing
    $source = [System.Drawing.Image]::FromFile((Join-Path $root "packaging\icon.png"))
    $small = New-Object System.Drawing.Bitmap 256, 256
    $g = [System.Drawing.Graphics]::FromImage($small)
    $g.InterpolationMode = "HighQualityBicubic"
    $g.DrawImage($source, 0, 0, 256, 256)
    $g.Dispose(); $source.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $small.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $small.Dispose()
    $png = $ms.ToArray()
    $out = New-Object System.IO.MemoryStream
    $w = New-Object System.IO.BinaryWriter $out
    $w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]1)           # ICONDIR
    $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0)   # 256x256, no palette
    $w.Write([UInt16]1); $w.Write([UInt16]32)                                # planes, bits
    $w.Write([UInt32]$png.Length); $w.Write([UInt32]22)                      # size, offset
    $w.Write($png)
    [System.IO.File]::WriteAllBytes($iconPath, $out.ToArray())

    $shell = New-Object -ComObject WScript.Shell
    $targets = @(
      (Join-Path ([Environment]::GetFolderPath("Desktop")) "WriteMind.lnk"),
      (Join-Path ([Environment]::GetFolderPath("Programs")) "WriteMind.lnk")
    )
    foreach ($path in $targets) {
      $link = $shell.CreateShortcut($path)
      $link.TargetPath = $electron
      $link.Arguments = '"' + (Join-Path $root "apps\desktop") + '"'
      $link.WorkingDirectory = Join-Path $root "apps\desktop"
      $link.IconLocation = $iconPath
      $link.Description = "WriteMind"
      $link.Save()
      Write-Host "    $path"
    }
  }
}

Write-Host ""
Write-Host "Done. Start WriteMind from the Desktop or Start menu shortcut," -ForegroundColor Green
Write-Host "or run:  npm run dev   (live reload)   /   npm test" -ForegroundColor Green
Write-Host "Notes are plain .md files in Documents\WriteMind." -ForegroundColor Green
Write-Host "For a Wacom tablet: Wacom Tablet Properties > Mapping > tick 'Use Windows Ink'." -ForegroundColor Green
