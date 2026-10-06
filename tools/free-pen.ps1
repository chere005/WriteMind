# free-pen.ps1 - the panic button for the pen and the mouse. Safe to run at any time, as often as you like.
#
#   Double-click tools\free-pen.cmd   (or:  powershell -NoProfile -ExecutionPolicy Bypass -File tools\free-pen.ps1)
#
# What it does, in this order:
#   1. Shows where the cursor is confined right now (GetClipCursor), then releases ANY cursor clip with ClipCursor(NULL).
#      That is the same call every program makes when it exits, so it cannot hurt anything: if nothing was clipped it does nothing.
#   2. If WriteMind is NOT running and it left a lease journal (pen-leases.json) behind, runs the guard's one-shot sweep:
#      it closes Wintab contexts named "WriteMind pen <pid>" whose process is dead (never anything else), and releases a clip
#      that is exactly the rectangle the journal records. Nothing is touched while WriteMind is running.
#   3. Shows the cursor clip again.
#
# It never starts, stops or touches WriteMind itself, never injects input and never moves the cursor.
# (docs/spikes/DESIGN-pen-capture.md 7.5. The same key also works inside the app: Ctrl+Alt+G.)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WmFreePen {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int l, t, r, b; }
  [DllImport("user32.dll", EntryPoint="ClipCursor")] public static extern bool Clip(IntPtr r);
  [DllImport("user32.dll")] public static extern bool GetClipCursor(out RECT r);
}
'@

function Show-Clip([string]$label) {
  $r = New-Object WmFreePen+RECT
  [void][WmFreePen]::GetClipCursor([ref]$r)
  Write-Host ("{0}: cursor is confined to ({1},{2}) - ({3},{4})" -f $label, $r.l, $r.t, $r.r, $r.b)
}

Show-Clip 'before'
[void][WmFreePen]::Clip([IntPtr]::Zero)

# --- the sweep of a journal an earlier run left behind (only when WriteMind is not running) -------------------------------------
$repo = Split-Path -Parent $PSScriptRoot
$userData = Join-Path $env:APPDATA '@writemind\desktop'
$journal = Join-Path $userData 'pen-leases.json'
if (Test-Path $journal) {
  $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq 'WriteMind' -or ($_.Path -and $_.Path -like '*WriteMind*electron.exe') })
  if ($running.Count -gt 0) {
    Write-Host 'WriteMind is running: its journal is live and is not touched.'
  } else {
    $guard = Join-Path $repo 'apps\desktop\out\main\pen-guard.mjs'
    $electron = Join-Path $repo 'node_modules\electron\dist\electron.exe'
    if ((Test-Path $guard) -and (Test-Path $electron)) {
      $env:ELECTRON_RUN_AS_NODE = '1'
      try {
        $out = & $electron $guard '--sweep' $journal 2>&1
        Write-Host ("sweep: {0}" -f ($out -join ' '))
      } finally { Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
    } else {
      Write-Host 'A lease journal is there but the guard script was not found next to this folder; the cursor clip is released above, but any leftover Wintab context stays until the Wacom driver restarts.'
    }
  }
} else {
  Write-Host 'No lease journal: nothing was left behind.'
}

[void][WmFreePen]::Clip([IntPtr]::Zero)
Show-Clip 'after '
Write-Host 'Done. If the pen still behaves oddly, close WriteMind and start it again.'
