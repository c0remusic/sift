# Window-thread probe for the performance baseline (issue #88). Companion of perf-baseline.mjs.
#
# Sends WM_NULL to the Sift main window with SendMessageTimeout every -IntervalMs and records
# every reply slower than -ThresholdMs. WM_NULL is answered by the thread that owns the window,
# which in Tauri v2 on Windows is the main thread running the event loop: a slow reply means a
# blocked window thread (a synchronous command, setup work, a long Rust callback), independent
# of what the WebView's own JS thread is doing.
#
# The target process is selected by its ExecutablePath, never by image name: several Tauri
# projects run on this machine and their binaries are all called by relative command lines.
#
# Usage:
#   powershell -NoProfile -File scripts/perf-window-probe.ps1 -ExePath <full path of sift.exe> -Seconds 120 [-Out probe.json]
param(
  [Parameter(Mandatory = $true)][string]$ExePath,
  [int]$Seconds = 120,
  [int]$IntervalMs = 20,
  [int]$ThresholdMs = 100,
  [string]$Out = ""
)

Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Probe {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
  public static IntPtr Find(uint target) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p);
      if (p == target && IsWindowVisible(h)) { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
}
"@

$procs = @(Get-CimInstance Win32_Process -Filter "Name='sift.exe'" | Where-Object { $_.ExecutablePath -eq $ExePath })
if ($procs.Count -ne 1) { throw "expected exactly one sift.exe at $ExePath, found $($procs.Count)" }
$targetPid = [uint32]$procs[0].ProcessId
$hwnd = [Probe]::Find($targetPid)
if ($hwnd -eq [IntPtr]::Zero) { throw "no visible window for pid $targetPid" }

$sw = [System.Diagnostics.Stopwatch]::new()
$start = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$slow = New-Object System.Collections.Generic.List[object]
$samples = New-Object System.Collections.Generic.List[double]
$SMTO_NORMAL = 0
while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $start -lt $Seconds * 1000) {
  $r = [IntPtr]::Zero
  $at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $sw.Restart()
  [void][Probe]::SendMessageTimeout($hwnd, 0, [IntPtr]::Zero, [IntPtr]::Zero, $SMTO_NORMAL, 10000, [ref]$r)
  $ms = $sw.Elapsed.TotalMilliseconds
  $samples.Add($ms)
  if ($ms -gt $ThresholdMs) { $slow.Add([pscustomobject]@{ atEpochMs = $at; ms = [math]::Round($ms, 1) }) }
  Start-Sleep -Milliseconds $IntervalMs
}

$sorted = $samples | Sort-Object
$q = { param($p) $sorted[[math]::Min($sorted.Count - 1, [math]::Floor($p * $sorted.Count))] }
$result = [pscustomobject]@{
  pid = $targetPid
  startEpochMs = $start
  seconds = $Seconds
  samples = $samples.Count
  p50 = [math]::Round((& $q 0.5), 2)
  p99 = [math]::Round((& $q 0.99), 2)
  max = [math]::Round($sorted[-1], 1)
  overThreshold = $slow
}
$json = $result | ConvertTo-Json -Depth 4
if ($Out) { Set-Content -Path $Out -Value $json -Encoding utf8 } else { $json }
