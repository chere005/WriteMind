# The optional tools of WriteMind's Windows installer (packaging/installer.nsh runs this; it is not installed).
#
#   -Detect -Out <ini>    what is already on this computer, as an INI the installer page reads:
#                           [tools] python=<path or empty>  wolfram=<wolframscript.exe or empty>
#                                   activated=1|0  winget=<path or empty>
#   -Python -Wolfram -Activate [-DryRun] [-NoWait] -Log <file> -Result <ini>
#                         installs what was ticked with winget, in this (visible) console, then opens a PowerShell
#                         window running  & "<path>\wolframscript.exe" -activate  so the person signs in with their own
#                         Wolfram ID. Anything already there is skipped. -DryRun says what it would run and runs
#                         nothing. The exit code is 0 when everything asked for is there (or was a dry run: a dry run
#                         fails nothing, it says what a real run would stop at), 1 when something failed; the
#                         installer never fails because of it. The result INI holds one short status per tool
#                         ("installed", "already installed", "failed: <why> (<winget's code>)"...), never winget's
#                         own output: that goes to the console and nowhere else.
#
# The places looked in are the ones WriteMind's own lookup uses (apps/desktop/src/main/eval/tools.ts), in the same
# order, so "already installed" here means WriteMind will find it, and the one named is the one it will use
# (apps/desktop/test/installerTools.test.ts holds both lookups to one set of folders). Test hook:
# WRITEMIND_TOOLS_PRETEND=missing makes -Detect report nothing (to see the page and the dry run as on a bare machine).
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
# python.org's installer. Python's docs mark it deprecated since 3.14 and say it is not made for 3.16 or later; winget
# already carries Python.PythonInstallManager, whose runtimes go elsewhere (%LOCALAPPDATA%\Python\pythoncore-<ver>-64,
# as it is understood here), which neither this script nor tools.ts searches. Before 3.16: move the id and BOTH
# lookups to it, with a test for its folders (docs/TODO.md, the Windows installer).
$PythonId = "Python.Python.3.14"
# FOR THIS WINDOWS USER ONLY, as the page promises. winget's --scope user picks the manifest's per-user installer,
# but its switches (InstallAllUsers=0 PrependPath=1) leave the py launcher at its default, InstallLauncherAllUsers=1,
# and Python's docs say a per-user install needs no administrator "unless ... you install the launcher for all
# users": on a machine with no launcher yet that is a Windows prompt for administrator rights, which a standard user
# cannot answer, and the whole install fails. So the switches are given whole (--override replaces winget's own, which
# for a burn installer are /passive /norestart and a /log of its own, plus the manifest's two): the launcher goes in
# %LOCALAPPDATA%\Programs\Python\Launcher\py.exe, where FindPython and tools.ts both look. --override rather than
# --custom (which adds to winget's switches) because every winget has --override and an older one has no --custom.
$PythonSwitches = "/passive /norestart InstallAllUsers=0 InstallLauncherAllUsers=0 PrependPath=1"
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

# Every hit on the PATH, in its order, not only the first (Get-Command without -All stops there): tools.ts tries every
# PATH folder, so a Store placeholder early on the PATH must not hide a real python.exe after it.
function OnPath([string]$name) {
  Get-Command $name -CommandType Application -All -ErrorAction SilentlyContinue |
    Where-Object { $_.Source -match '\.(exe|com)$' } | ForEach-Object { $_.Source }
}

# One argument as a Windows command line carries it (the rules CommandLineToArgvW and the C runtime read it back by):
# quoted when it holds a space, a tab or a quote, a quote escaped, and the backslashes before a quote doubled.
function QuoteArgument([string]$text) {
  if ($text -ne "" -and $text -notmatch '[\s"]') { return $text }
  return '"' + (($text -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}

function JoinArguments([string[]]$arguments) {
  ($arguments | ForEach-Object { QuoteArgument $_ }) -join " "
}

# Does this start a Python 3? A PROBE, so it may never wait. The installer runs -Detect through nsExec, which hands
# this script a stdin pipe that nobody closes, and a child that inherits it and asks something (a py from Python's new
# install manager offering to fetch a runtime, say) would wait on it for good, and the installer's Next with it. So
# the child gets a stdin that is closed at once, its output is read here, and one still running after ten seconds is
# killed and is not a Python.
function Works([string]$exe, [string[]]$arguments) {
  try {
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $exe
    $start.Arguments = JoinArguments $arguments
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::Start($start)
    try { $process.StandardInput.Close() } catch { }
    $out = $process.StandardOutput.ReadToEndAsync()
    $err = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(10000)) {
      try { $process.Kill() } catch { }
      return $false
    }
    $output = ""
    if ($out.Wait(2000)) { $output += $out.Result }
    if ($err.Wait(2000)) { $output += $err.Result }
    return ($process.ExitCode -eq 0 -and $output -match 'Python 3')
  } catch { return $false }
}

# The Wolfram Engine's version folders, newest first, as tools.ts's newestFirst orders them: number by number, so
# 14.10 comes before 14.9 (by name, 14.9 would win).
function EngineFolders([string]$dir) {
  if (-not (Test-Path -LiteralPath $dir)) { return @() }
  Get-ChildItem -LiteralPath $dir -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\d+(\.\d+)*$' } |
    Sort-Object -Descending -Property @{ Expression = { ($_.Name.Split(".") | ForEach-Object { $_.PadLeft(9, "0") }) -join "." } }
}

# python.org's Python3NN folders, as tools.ts's pythonFolders orders them: the newest version first, and of one
# version the plain (64-bit) folder before Python3NN-32 / -arm64, then by name.
function PythonFolders([string]$dir) {
  if (-not (Test-Path -LiteralPath $dir)) { return @() }
  Get-ChildItem -LiteralPath $dir -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^Python3\d+(-32|-arm64)?$' } |
    Sort-Object -Property @{ Expression = { [int]($_.Name -replace '^Python3(\d+).*$', '$1') }; Descending = $true },
      @{ Expression = { $_.Name -match '-' }; Descending = $false },
      @{ Expression = { $_.Name }; Descending = $false }
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
    foreach ($folder in (PythonFolders $dir)) {
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
    foreach ($folder in (EngineFolders (Join-Path $research "Wolfram Engine"))) {
      $exe = Join-Path $folder.FullName "wolframscript.exe"
      if (Test-Path -LiteralPath $exe) { return $exe }
    }
  }
  return ""
}

function IsActivated {
  # Activation leaves a "mathpass" licence file; the engine's per-user one, or a site-wide one. Since 14.1 Wolfram's
  # own support page names Wolfram\Licensing for both (support.wolfram.com/66864); WolframEngine\ and Mathematica\
  # are where older versions put it. (Where Engine 15.0 writes it is to be seen at its first real activation.)
  if ($env:WRITEMIND_TOOLS_PRETEND -eq "missing") { return $false }
  foreach ($base in @($env:APPDATA, $env:ProgramData)) {
    if (-not $base) { continue }
    foreach ($product in @("Wolfram", "WolframEngine", "Mathematica")) {
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

# What winget's exit code means, in the words the summary, wm-result.ini and the installer's last message show
# (winget's own list: doc/windows/package-manager/winget/returnCodes.md in microsoft/winget-cli). The ones a person
# can act on are said in words; anything else keeps its code, which is what to search for.
function WingetOutcome([int]$code) {
  if ($code -eq 0) { return "installed" }
  # An installer's own "restart to finish", in case winget passes it on as it is.
  if ($code -eq 3010) { return "installed (restart needed)" }
  $hex = "0x{0:X8}" -f $code
  switch ($hex) {
    # winget's word for an installer's 3010: "Restart your PC to finish installation". It installed.
    "0x8A150109" { return "installed (restart needed)" }
    # No applicable upgrade / the package is already installed.
    "0x8A15002B" { return "already installed" }
    "0x8A150061" { return "already installed" }
    # The installer quit with a code winget has no word for. For a burn installer (both of these are) winget's own
    # list (GetDefaultKnownReturnCodes in winget-cli's ManifestCommon.cpp) knows only the MSI codes, and Windows'
    # prompt to allow the install answered No (or closed, or one a standard user cannot approve) ends a burn bundle
    # with 1223, ERROR_CANCELLED, which is not among them: so a declined prompt shows as THIS code, never as the
    # cancelled one below. It is the Wolfram Engine's likeliest failure: its manifest is a zip holding a burn
    # installer that raises the prompt itself, and adds no codes of its own. Which of the two it was is the
    # installer's own exit code, which winget prints in the console ("Installer failed with exit code: 1223") and
    # nowhere this script can read it.
    "0x8A150006" { return "failed: the installer stopped or its prompt to allow it was declined, its own exit code is in the console ($hex)" }
    # The installer's own Cancel: 1602 (ERROR_INSTALL_USEREXIT), the one code winget's list calls cancelled by the user.
    "0x8A15010C" { return "failed: cancelled, the install was stopped in the installer's own window ($hex)" }
    # The manifest is newer than this winget, or it does not know an argument: App Installer is too old.
    "0x8A150007" { return "failed: winget is too old, update App Installer from the Microsoft Store ($hex)" }
    "0x8A150002" { return "failed: winget is too old, update App Installer from the Microsoft Store ($hex)" }
    "0x8A150010" { return "failed: not available for this PC ($hex)" }
    "0x8A150008" { return "failed: the download did not finish, is this computer online? ($hex)" }
    "0x8A150107" { return "failed: no internet connection ($hex)" }
  }
  # WinINet's errors (12001-12175, as HRESULTs 0x80072EE1-0x80072F8F): no connection, no name, a timeout.
  if ($hex -match '^0x80072(EE|EF|F[0-8])') { return "failed: the download did not finish, is this computer online? ($hex)" }
  return "failed: winget exit code $hex"
}

# Runs a program IN THIS CONSOLE and returns its exit code, and nothing else. Not `& $winget @arguments`: inside a
# function whose result is assigned (`$results.python = WingetInstall ...`), PowerShell hands a native program's
# output to the function's OUTPUT. The console then showed nothing of winget's between the command line and the end
# of a 3 GB download, and the result was every line winget printed followed by the status: "System.Object[]" in the
# summary, `python=<all of winget's output> installed` in wm-result.ini and in the installer's last message. A process
# started with UseShellExecute off and nothing redirected shares this console (and its stdin, for a question winget
# might ask), as a program typed at a prompt does; and WaitForExit waits for it alone, where Start-Process -Wait
# waits for every process it starts as well.
function RunInConsole([string]$exe, [string[]]$arguments) {
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $exe
  $start.Arguments = JoinArguments $arguments
  $start.UseShellExecute = $false
  $process = [System.Diagnostics.Process]::Start($start)
  $process.WaitForExit()
  return $process.ExitCode
}

function WingetInstall([string]$label, [string]$id, [string[]]$extra) {
  $winget = FindWinget
  $script:results.winget = $(if ($winget) { $winget } else { "missing" })
  $arguments = @("install", "--id", $id, "--exact", "--source", "winget") + $extra +
    @("--accept-package-agreements", "--accept-source-agreements")
  if (-not $winget) {
    if ($DryRun) {
      Say "[$label] winget is not on this computer; a real run would stop here." "Yellow"
      Say "[$label] would run: winget $(JoinArguments $arguments)"
      return "dry run (winget missing)"
    }
    Say "[$label] winget (App Installer) is not on this computer, so $label cannot be installed from here." "Red"
    Say "[$label] Install 'App Installer' from the Microsoft Store, or $label by hand; see $Docs" "Red"
    $script:failed = $true
    return "failed: winget is missing"
  }
  Say "[$label] winget $(JoinArguments $arguments)" "Cyan"
  if ($DryRun) { return "dry run" }
  try { $code = RunInConsole $winget $arguments }
  catch {
    Say "[$label] winget did not start: $($_.Exception.Message)" "Red"
    $script:failed = $true
    return "failed: winget did not start"
  }
  $outcome = WingetOutcome $code
  if ($outcome -like "failed*") {
    Say "[$label] $outcome. WriteMind still works without it; see $Docs" "Red"
    $script:failed = $true
  } else {
    Say "[$label] $outcome." "Green"
  }
  return $outcome
}

if ($Python) {
  $there = FindPython
  if ($there) { Say "[Python] already installed: $there"; $results.python = "already installed" }
  else {
    # Per-user, the launcher too (no administrator prompt: $PythonSwitches). WriteMind finds it in
    # %LOCALAPPDATA%\Programs\Python without the PATH.
    $results.python = WingetInstall "Python" $PythonId @("--scope", "user", "--override", $PythonSwitches)
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
    } elseif ($DryRun) {
      # A dry run fails nothing (the header's promise, and the installer shows its "not everything could be done"
      # box for exit 1): it says what a real run would stop at.
      Say "[Activate] wolframscript.exe was not found; a real run would stop here. See $Docs" "Yellow"
      $results.activate = "dry run (wolframscript.exe not found)"
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
