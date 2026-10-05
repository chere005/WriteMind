# Persistent synthetic pen + mouse injector. Reads lines on stdin, answers "ok" per line.
# pen hover x y | pen down x y [p] | pen move x y [p] | pen up x y | pen leave x y
# mouse move x y | mouse down | mouse up | quit      (x y = PHYSICAL screen pixels)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Inj {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] public struct POINTER_INFO {
    public uint pointerType, pointerId, frameId, pointerFlags; public IntPtr sourceDevice, hwndTarget;
    public POINT ptPixelLocation, ptHimetricLocation, ptPixelLocationRaw, ptHimetricLocationRaw;
    public uint dwTime, historyCount; public int InputData; public uint dwKeyStates; public ulong PerformanceCount; public int ButtonChangeType; }
  [StructLayout(LayoutKind.Sequential)] public struct POINTER_PEN_INFO { public POINTER_INFO pointerInfo; public uint penFlags, penMask, pressure, rotation; public int tiltX, tiltY; }
  [StructLayout(LayoutKind.Explicit, Size=256)] public struct POINTER_TYPE_INFO { [FieldOffset(0)] public uint type; [FieldOffset(8)] public POINTER_PEN_INFO penInfo; }
  [DllImport("user32.dll")] public static extern IntPtr CreateSyntheticPointerDevice(uint t, uint maxContacts, uint mode);
  [DllImport("user32.dll")] public static extern bool InjectSyntheticPointerInput(IntPtr dev, [In] POINTER_TYPE_INFO[] info, uint count);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  public static IntPtr dev;
  public static string Pen(uint flags, int x, int y, uint pressure) {
    if (dev == IntPtr.Zero) dev = CreateSyntheticPointerDevice(3, 1, 1);
    var i = new POINTER_TYPE_INFO[1];
    i[0].type = 3;
    i[0].penInfo.pointerInfo.pointerType = 3; i[0].penInfo.pointerInfo.pointerId = 1;
    i[0].penInfo.pointerInfo.pointerFlags = flags;
    i[0].penInfo.pointerInfo.ptPixelLocation.x = x; i[0].penInfo.pointerInfo.ptPixelLocation.y = y;
    i[0].penInfo.penMask = 1; i[0].penInfo.pressure = pressure;
    bool r = InjectSyntheticPointerInput(dev, i, 1);
    return r ? "ok" : ("err " + Marshal.GetLastWin32Error());
  }
}
'@
[void][Inj]::SetProcessDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Windows.Forms
# Commands are given on a 1920x1200 reference display; pen and cursor positions are scaled to the real primary display.
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$SX = $b.Width / 1920.0; $SY = $b.Height / 1200.0
# NEW=1 INRANGE=2 INCONTACT=4 FIRST=0x10 PRIMARY=0x2000 DOWN=0x10000 UPDATE=0x20000 UP=0x40000
$HOVER = 0x2 -bor 0x20000 -bor 0x2000
$DOWN = 0x2 -bor 0x4 -bor 0x10 -bor 0x10000 -bor 0x2000
$MOVE = 0x2 -bor 0x4 -bor 0x10 -bor 0x20000 -bor 0x2000
$UP = 0x2 -bor 0x40000 -bor 0x2000
$LEAVE = 0x20000 -bor 0x2000
[Console]::Out.WriteLine("ready"); [Console]::Out.Flush()
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $p = $line.Trim() -split '\s+'
  $r = 'ok'
  try {
    if ($p[0] -eq 'quit') { break }
    elseif ($p[0] -eq 'pen') {
      $x = [int]([int]$p[2] * $SX); $y = [int]([int]$p[3] * $SY); $pr = if ($p.Length -gt 4) { [uint32]$p[4] } else { 512 }
      switch ($p[1]) {
        'hover' { $f = $HOVER; if (-not $script:inr) { $f = $f -bor 1 }; $script:inr = $true; $r = [Inj]::Pen($f, $x, $y, 0) }
        'down'  { $script:inr = $true; $r = [Inj]::Pen($DOWN, $x, $y, $pr) }
        'move'  { $r = [Inj]::Pen($MOVE, $x, $y, $pr) }
        'up'    { $r = [Inj]::Pen($UP, $x, $y, 0) }
        'leave' { $script:inr = $false; $r = [Inj]::Pen($LEAVE, $x, $y, 0) }
      }
    } elseif ($p[0] -eq 'sig') {
      $ex = [UIntPtr][uint64]4283520768
      switch ($p[1]) {
        'move' { [Inj]::mouse_event(0x8001, [int]([int]$p[2]*65535/1919), [int]([int]$p[3]*65535/1199), 0, $ex) }
        'down' { [Inj]::mouse_event(2,0,0,0,$ex) }
        'up'   { [Inj]::mouse_event(4,0,0,0,$ex) }
      }
    } elseif ($p[0] -eq 'cursor') { [void][Inj]::SetCursorPos([int]([int]$p[1] * $SX), [int]([int]$p[2] * $SY)) }
    elseif ($p[0] -eq 'mouse') {
      switch ($p[1]) {
        'move' { [Inj]::mouse_event(0x8001, [int]([int]$p[2]*65535/1919), [int]([int]$p[3]*65535/1199), 0, [UIntPtr]::Zero) }
        'down' { [Inj]::mouse_event(2,0,0,0,[UIntPtr]::Zero) }
        'up'   { [Inj]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
      }
    }
  } catch { $r = "exc $_" }
  [Console]::Out.WriteLine($r); [Console]::Out.Flush()
}
