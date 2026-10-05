# WriteMind's Windows helper: the words in a picture, read by the OCR engine
# Windows itself ships (Windows.Media.Ocr, WinRT). Nothing to install for the
# languages in the user's profile; Japanese needs the Windows "Japanese OCR"
# capability (see docs/OCR-WINDOWS.md). It is the Windows twin of
# tools/vision/wm-vision.swift and answers in the same shape.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File wm-ocr.ps1 probe
#   powershell -NoProfile -ExecutionPolicy Bypass -File wm-ocr.ps1 read <image> [-Languages ja,en-US]
#
# Out goes ONE line of JSON on stdout, pure ASCII (every other character is a
# \uXXXX escape, so the console's code page cannot mangle Japanese). Anything
# wrong is JSON too, with an "error". Boxes are FRACTIONS of the picture, y
# DOWN from the top left - the same as wm-vision's.
#
# Windows PowerShell 5.1 only (that is what ships with Windows 10).

param(
  [Parameter(Position = 0)][string]$Command = 'probe',
  [Parameter(Position = 1)][string]$Image = '',
  [string[]]$Languages = @()
)

$ErrorActionPreference = 'Stop'
# `-File` hands over "ja,en-US" as one string.
$Languages = @($Languages | ForEach-Object { $_ -split ',' } | Where-Object { $_ })

function Emit($object) {
  $json = $object | ConvertTo-Json -Depth 8 -Compress
  $ascii = [regex]::Replace($json, '[^\u0000-\u007F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
  [Console]::Out.WriteLine($ascii)
}

function Fail($message) {
  Emit @{ error = [string]$message }
  exit 1
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
} catch {
  Fail "Windows.Media.Ocr is not available on this Windows: $($_.Exception.Message)"
}

# WinRT async -> a blocking call. PowerShell 5.1 cannot await; the AsTask
# extension turns an IAsyncOperation<T> into a Task, which can be waited on.
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Await($operation, [Type]$resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  if (-not $task.Wait(60000)) { throw 'the OCR engine timed out' }
  return $task.Result
}

$engineType = [Windows.Media.Ocr.OcrEngine]
$installed = @($engineType::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag })
$profileEngine = $engineType::TryCreateFromUserProfileLanguages()
$profileTag = if ($profileEngine) { $profileEngine.RecognizerLanguage.LanguageTag } else { $null }
$hasJapanese = @($installed | Where-Object { $_ -like 'ja*' }).Count -gt 0

function Describe() {
  return @{
    installed = $installed
    profile = $profileTag
    japanese = $hasJapanese
    maxImageDimension = [int]$engineType::MaxImageDimension
    addJapanese = 'Add-WindowsCapability -Online -Name Language.OCR~~~ja-JP~0.0.1.0   (an elevated PowerShell), or Settings > Time & Language > Language > Japanese > Language options > Optical character recognition'
  }
}

if ($Command -eq 'probe') {
  $info = Describe
  $info.ok = ($installed.Count -gt 0)
  Emit $info
  exit 0
}

if ($Command -ne 'read') { Fail "unknown command $Command" }
if (-not $Image -or -not (Test-Path -LiteralPath $Image)) { Fail "could not read $Image" }

function Engine-For([string]$tag) {
  $language = New-Object Windows.Globalization.Language $tag
  if (-not $engineType::IsLanguageSupported($language)) { return $null }
  return $engineType::TryCreateFromLanguage($language)
}

# The picture, decoded once; a bitmap of it is made at whatever scale is asked for.
$full = (Resolve-Path -LiteralPath $Image).ProviderPath
try {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($full)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
} catch {
  Fail "could not decode $Image : $($_.Exception.Message)"
}
$width = [double]$decoder.PixelWidth
$height = [double]$decoder.PixelHeight
$limit = [double]$engineType::MaxImageDimension
$long = [Math]::Max($width, $height)

# The scale the engine reads best at: no bigger than its side limit, and a small
# picture is brought up (its text is small too).
$first = 1.0
if ($long -gt $limit) { $first = $limit / $long }
elseif ($long -lt 900) { $first = [Math]::Min(2.0, 1800 / $long) }

function Bitmap-At([double]$factor) {
  $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
  $transform.ScaledWidth = [uint32][Math]::Max(1, [Math]::Floor($width * $factor))
  $transform.ScaledHeight = [uint32][Math]::Max(1, [Math]::Floor($height * $factor))
  return Await ($decoder.GetSoftwareBitmapAsync(
      [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
      [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,
      $transform,
      [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation,
      [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
}

function Read-With($engine, $bitmap) {
  $bw = [double]$bitmap.PixelWidth
  $bh = [double]$bitmap.PixelHeight
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = @()
  foreach ($line in $result.Lines) {
    $words = @()
    $x0 = [double]::MaxValue; $y0 = [double]::MaxValue; $x1 = 0.0; $y1 = 0.0
    foreach ($word in $line.Words) {
      $r = $word.BoundingRect
      $words += @{ text = $word.Text; x = $r.X / $bw; y = $r.Y / $bh; width = $r.Width / $bw; height = $r.Height / $bh }
      $x0 = [Math]::Min($x0, $r.X); $y0 = [Math]::Min($y0, $r.Y)
      $x1 = [Math]::Max($x1, $r.X + $r.Width); $y1 = [Math]::Max($y1, $r.Y + $r.Height)
    }
    if ($words.Count -eq 0) { continue }
    $lines += @{
      text = $line.Text; confidence = 1.0
      x = $x0 / $bw; y = $y0 / $bh; width = ($x1 - $x0) / $bw; height = ($y1 - $y0) / $bh
      words = $words
    }
  }
  $angle = $null
  if ($result.TextAngle -ne $null) { $angle = [double]$result.TextAngle }
  return @{ lines = $lines; angle = $angle }
}

function Has-Japanese($read) {
  foreach ($line in $read.lines) {
    if ($line.text -match '[\u3040-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uFF66-\uFF9D]') { return $true }
  }
  return $false
}

# WHICH LANGUAGE. The Mac's rule (TextRecognition.readBest): Japanese first
# when the machine has it, kept only when it found any Japanese - an English
# page read Japanese-first comes back as nonsense - otherwise the profile's
# languages. Languages named on the command line replace the plan.
$plan = @()
if ($Languages.Count -gt 0) {
  foreach ($tag in $Languages) { $e = Engine-For $tag; if ($e) { $plan += @{ tag = $tag; engine = $e } } }
} else {
  if ($hasJapanese) {
    $tag = $installed | Where-Object { $_ -like 'ja*' } | Select-Object -First 1
    $e = Engine-For $tag
    if ($e) { $plan += @{ tag = $tag; engine = $e; needsJapanese = $true } }
  }
  if ($profileEngine) { $plan += @{ tag = $profileTag; engine = $profileEngine } }
  elseif ($installed.Count -gt 0) { $e = Engine-For $installed[0]; if ($e) { $plan += @{ tag = $installed[0]; engine = $e } } }
}
if ($plan.Count -eq 0) {
  $out = Describe
  if ($Languages.Count -gt 0) {
    $out.error = "none of the languages asked for ($($Languages -join ', ')) has an OCR engine on this Windows (it has: $($installed -join ', ')); see addJapanese for how a language is added"
  } else {
    $out.error = 'no OCR language is installed for this Windows user (Settings > Time & Language > Language, add one with Optical character recognition)'
  }
  Emit $out
  exit 1
}

# The engine sometimes answers NOTHING for a picture whose text is simply too big
# for it (a single line of 60px type in a small picture, measured); a picture
# that comes back empty is tried again smaller before it is called empty.
$chosen = $null; $read = $null; $factor = $first
try {
  foreach ($try in @(1.0, 0.6, 0.4)) {
    $factor = $first * $try
    if ($factor * $long -lt 200) { break }
    $bitmap = Bitmap-At $factor
    foreach ($step in $plan) {
      $attempt = Read-With $step.engine $bitmap
      if ($step.needsJapanese -and -not (Has-Japanese $attempt)) { continue }
      $chosen = $step.tag; $read = $attempt
      break
    }
    if ($read -and $read.lines.Count -gt 0) { break }
  }
  $stream.Dispose()
  if (-not $read) { $read = @{ lines = @(); angle = $null }; $chosen = $plan[-1].tag }
} catch {
  Fail "the OCR engine failed: $($_.Exception.Message)"
}

$out = Describe
$out.language = $chosen
$out.lines = $read.lines
$out.angle = $read.angle
$out.scale = $factor
Emit $out
exit 0
