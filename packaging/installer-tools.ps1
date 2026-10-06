# The optional tools of WriteMind's Windows installer (packaging/installer.nsh runs this; it is not installed).
#
#   -Detect -Out <ini>    what is already on this computer, as an INI the installer page reads:
#                           [tools] python=<path or empty>  wolfram=<wolframscript.exe or empty>
#                                   activated=1|0  winget=<path or empty>
#   -Python -Wolfram -Activate [-DryRun] [-NoWait] -Log <file> -Result <ini>
#                         installs what was ticked with winget, in this (visible) console, then opens a PowerShell
#                         window running  & "<path>\wolframscript.exe" -activate  so the person signs in with their own
#                         Wolfram ID. Anything already there is skipped. -DryRun says what it would run and runs
#                         nothing. The exit code is 0 when everything asked for is there (or was a dry run), 1 when
#                         something failed; the installer never fails because of it.
#
# The places looked in are the ones WriteMind's own lookup uses (apps/desktop/src/main/eval/tools.ts), so "already
# installed" here means WriteMind will find it. Test hook: WRITEMIND_TOOLS_PRETEND=missing makes -Detect report
# nothing (to see the page and the dry run as on a bare machine).
#
# ASCII only: Windows PowerShell 5.1 reads a script without a BOM in the ANSI code page.

param(
  [switch]$Detect,
  [string]$Out = "",
  [switch]$Python,
  [switch]$Wolfram,
  [switch]$Activate,
  [switch]$DryRun,
  [switch]$NoWait,
  [string]$Log = "",
  [string]$Result = ""
)

$ErrorActionPreference = "Continue"
$PythonId = "Python.Python.3.14"
$WolframId = "WolframResearch.WolframEngine"
$Docs = "https://github.com/chere005/WriteMind/blob/main/docs/INSTALL-WINDOWS.md#optional-tools-python-and-wolfram"

function Say([string]$text, [string]$color = "") {
  if ($color) { Write-Host $text -ForegroundColor $color } else { Write-Host $text }
  if ($Log) {
    try { Add-Content -LiteralPath $Log -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $text) -Encoding UTF8 } catch { }
  }
}

function ProgramFolders {
  # A 32-bit process sees ProgramFiles as "Program Files (x86)": ProgramW6432 is the 64-bit one.
  @($env:ProgramW6432, $env:ProgramFiles, ${env:ProgramFiles(x86)}) |
    Where-Object { $_ } | Select-Object -Unique
}

function OnPath([string]$name) {
  Get-Command $name -CommandType Application -ErrorAction SilentlyContinue |
    Where-Object { $_.Source -match '\.(exe|com)$' } | ForEach-Object { $_.Source }
}

function Works([string]$exe, [string[]]$arguments) {
  try {
    $output = & $exe @arguments 2>&1 | Out-String
    return ($LASTEXITCODE -eq 0 -and $output -match 'Python 3')
  } catch { return $false }
}

function VersionFolders([string]$dir, [string]$pattern) {
  if (-not (Test-Path -LiteralPath $dir)) { return @() }
  Get-ChildItem -LiteralPath $dir -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match $pattern } |
    Sort-Object -Descending -Property @{ Expression = { if ($_.Name -match '(\d+)') { [int]$Matches[1] } else { 0 } } }, Name
}

function FindPython {
  if ($env:WRITEMIND_TOOLS_PRETEND -eq "missing") { return "" }
  # 1. The PATH, as WriteMind looks (py first). The launcher only counts when it has a Python 3 behind it, and the
  #    Store's python.exe placeholder (WindowsApps) only when it is the real thing.
  foreach ($exe in (OnPath "py.exe")) { if (Works $exe @("-3", "--version")) { return $exe } }
  foreach ($name in @("python3.exe", "python.exe")) {
    foreach ($exe in (OnPath $name)) {
      if ($exe -match '\\WindowsApps\\') { if (Works $exe @("--version")) { return $exe } }
      else { return $exe }
    }
  }
  # 2. python.org's own folders, which a PATH may not reach (per-user first).
  $local = Join-Path $env:LOCALAPPDATA "Programs\Python"
  $launcher = Join-Path $local "Launcher\py.exe"
  if ((Test-Path -LiteralPath $launcher) -and (Works $launcher @("-3", "--version"))) { return $launcher }
  foreach ($dir in @($local) + @(ProgramFolders)) {
    foreach ($folder in (VersionFolders $dir '^Python3\d+(-32|-arm64)?$')) {
      $exe = Join-Path $folder.FullName "python.exe"
      if (Test-Path -LiteralPath $exe) { return $exe }
    }
  }
  return ""
}

function FindWolframScript {
  if ($env:WRITEMIND_TOOLS_PRETEND -eq "missing") { return "" }
  foreach ($exe in (OnPath "wolframscript.exe")) { return $exe }
  foreach ($dir in (ProgramFolders)) {
    $research = Join-Path $dir "Wolfram Research"
    $own = Join-Path $research "WolframScript\wolframscript.exe"
    if (Test-Path -LiteralPath $own) { return $own }
    foreach ($folder in (VersionFolders (Join-Path $research "Wolfram Engine") '^\d+(\.\d+)*$')) {
      $exe = Join-Path $folder.FullName "wolframscript.exe"
      if (Test-Path -LiteralPath $exe) { return $exe }
    }
  }
  return ""
}

function IsActivated {
  # Activation leaves a "mathpass" licence file; the engine's per-user one, or a site-wide one.
  if ($env:WRITEMIND_TOOLS_PRETEND -eq "missing") { return $false }
  foreach ($base in @($env:APPDATA, $env:ProgramData)) {
    if (-not $base) { continue }
    foreach ($product in @("WolframEngine", "Mathematica")) {
      if (Test-Path -LiteralPath (Join-Path $base "$product\Licensing\mathpass")) { return $true }
    }
  }
  return $false
}

function FindWinget {
  foreach ($exe in (OnPath "winget.exe")) { return $exe }
  $alias = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\winget.exe"
  if (Test-Path -LiteralPath $alias) { return $alias }
  return ""
}

function WriteIni([string]$file, [string]$section, [System.Collections.Specialized.OrderedDictionary]$values) {
  if (-not $file) { return }
  $lines = @("[$section]") + ($values.Keys | ForEach-Object { "$_=$($values[$_])" })
  # UTF-16 with a BOM: what the installer's ReadINIStr (GetPrivateProfileStringW) reads, whatever the path holds.
  [System.IO.File]::WriteAllText($file, ($lines -join "`r`n") + "`r`n", [System.Text.Encoding]::Unicode)
}

# --- Detect ------------------------------------------------------------------------------------------------------
if ($Detect) {
  $found = [ordered]@{
    python    = (FindPython)
    wolfram   = (FindWolframScript)
    activated = $(if (IsActivated) { "1" } else { "0" })
    winget    = (FindWinget)
  }
  WriteIni $Out "tools" $found
  $found.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }
  exit 0
}

# --- Install -----------------------------------------------------------------------------------------------------
try { $Host.UI.RawUI.WindowTitle = "WriteMind setup - optional tools" } catch { }
$results = [ordered]@{ python = "not asked"; wolfram = "not asked"; activate = "not asked"; winget = "" }
$failed = $false
$asked = @()
if ($Python) { $asked += "Python" }
if ($Wolfram) { $asked += "Wolfram Engine" }
if ($Activate) { $asked += "activate the Wolfram Engine" }
Say ""
Say "WriteMind is installed. Now the optional tools you ticked: $($asked -join ', ')." "Cyan"
if ($DryRun) { Say "DRY RUN: nothing is installed or opened; this only says what would be run." "Yellow" }
Say "If anything here fails, WriteMind still works; see $Docs"
Say ""

# Winget exit codes that mean "it is already there": no applicable upgrade, package already installed.
$alreadyCodes = @(-1978335189, -1978335135)

function WingetInstall([string]$label, [string]$id, [string[]]$extra) {
  $winget = FindWinget
  $script:results.winget = $(if ($winget) { $winget } else { "missing" })
  $arguments = @("install", "--id", $id, "--exact", "--source", "winget") + $extra +
    @("--accept-package-agreements", "--accept-source-agreements")
  if (-not $winget) {
    if ($DryRun) {
      Say "[$label] winget is not on this computer; a real run would stop here." "Yellow"
      Say "[$label] would run: winget $($arguments -join ' ')"
      return "dry run (winget missing)"
    }
    Say "[$label] winget (App Installer) is not on this computer, so $label cannot be installed from here." "Red"
    Say "[$label] Install 'App Installer' from the Microsoft Store, or $label by hand; see $Docs" "Red"
    $script:failed = $true
    return "failed: winget is missing"
  }
  Say "[$label] winget $($arguments -join ' ')" "Cyan"
  if ($DryRun) { return "dry run" }
  & $winget @arguments
  $code = $LASTEXITCODE
  if ($code -eq 0) { Say "[$label] installed." "Green"; return "installed" }
  if ($alreadyCodes -contains $code) { Say "[$label] already installed." "Green"; return "already installed" }
  if ($code -eq 3010) { Say "[$label] installed; Windows wants a restart to finish." "Green"; return "installed (restart needed)" }
  $hex = "0x{0:X8}" -f $code
  Say "[$label] winget stopped with exit code $code ($hex). WriteMind still works without it; see $Docs" "Red"
  $script:failed = $true
  return "failed: winget exit code $hex"
}

if ($Python) {
  $there = FindPython
  if ($there) { Say "[Python] already installed: $there"; $results.python = "already installed" }
  else {
    # Per-user (no administrator prompt). WriteMind finds it in %LOCALAPPDATA%\Programs\Python without the PATH.
    $results.python = WingetInstall "Python" $PythonId @("--scope", "user")
    if (-not $DryRun -and $results.python -like "installed*" -and -not (FindPython)) {
      Say "[Python] winget says it is installed, but python.exe is not where WriteMind looks. See $Docs" "Yellow"
    }
  }
}

if ($Wolfram) {
  $there = FindWolframScript
  if ($there) { Say "[Wolfram Engine] already installed: $there"; $results.wolfram = "already installed" }
  else {
    Say "[Wolfram Engine] about 3 GB to download; Windows asks to allow the install (it goes in Program Files)."
    Say "[Wolfram Engine] by installing it you accept https://www.wolfram.com/legal/terms/wolfram-engine.html"
    $results.wolfram = WingetInstall "Wolfram Engine" $WolframId @()
  }
}

if ($Activate) {
  $ws = FindWolframScript
  if ((IsActivated) -and $ws) {
    Say "[Activate] the Wolfram Engine is already activated."
    $results.activate = "already activated"
  } elseif (-not $ws) {
    if ($DryRun -and $Wolfram) {
      $ws = Join-Path $(if ($env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }) "Wolfram Research\Wolfram Engine\<version>\wolframscript.exe"
    } else {
      Say "[Activate] wolframscript.exe was not found, so there is nothing to activate yet. See $Docs" "Red"
      $results.activate = "failed: wolframscript.exe not found"
      $failed = $true
    }
  }
  if ($ws -and $results.activate -eq "not asked") {
    $quoted = $ws.Replace("'", "''")
    $command = "`$Host.UI.RawUI.WindowTitle = 'Activate the Wolfram Engine'; " +
      "Write-Host 'Sign in with your Wolfram ID (free at https://account.wolfram.com). WriteMind never sees it.' -ForegroundColor Cyan; " +
      "& '$quoted' -activate; " +
      "Write-Host ''; Write-Host 'You can close this window.'"
    Say "[Activate] opens a PowerShell window running: & `"$ws`" -activate" "Cyan"
    if ($DryRun) { $results.activate = "dry run" }
    else {
      $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($command))
      try {
        Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit", "-NoProfile", "-EncodedCommand", $encoded) | Out-Null
        $results.activate = "opened"
      } catch {
        Say "[Activate] could not open the window: $($_.Exception.Message)" "Red"
        $results.activate = "failed: could not open the window"
        $failed = $true
      }
    }
  }
}

if (-not $results.winget) { $results.winget = $(if (FindWinget) { FindWinget } else { "missing" }) }
WriteIni $Result "result" $results
Say ""
foreach ($key in @("python", "wolfram", "activate")) { Say ("  {0,-9} {1}" -f $key, $results[$key]) }
Say ""
if ($failed) {
  Say "Something above did not install. WriteMind itself is installed and works; Python and Wolfram cells say what they need when they run." "Yellow"
  if (-not $NoWait) { Read-Host "Press Enter to close this window" | Out-Null }
  exit 1
}
Say "Done." "Green"
if (-not $NoWait) { Start-Sleep -Seconds 4 }
exit 0
