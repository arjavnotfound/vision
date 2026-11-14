<#
Report how VISION's windows sit next to another app. Run it while VISION is running.

  powershell -ExecutionPolicy Bypass -File scripts\qa\probe-windows.ps1 -Out report.txt `
    [-Edge | -Chrome [-Url <page>] [-FullScreen]] [-Points "768,432;768,736"] [-Seconds 30]

Writes, with timestamps:
  - every visible top-level VISION window: title, rect and extended style flags
    (TOPMOST, TRANSPARENT = click-through, LAYERED, NOACTIVATE);
  - for each point, the window that a click there would hit (WindowFromPoint);
  - what Windows thinks of the screen (SHQueryUserNotificationState: BUSY means "a
    full-screen app is running", which silences notifications);
  - every change of the foreground window during -Seconds.
-Edge (or -Chrome, Google Chrome) opens the browser with a throwaway profile in front first
(at -Url, full screen with -FullScreen), and closes it at the end. Never probe with Notepad: it restores the owner's own tabs into the screen.
#>
param(
	[Parameter(Mandatory = $true)][string]$Out,
	[string]$Points = "",
	[int]$Seconds = 30,
	[switch]$Edge,
	[switch]$Chrome,
	[string]$Url = "about:blank",
	[switch]$FullScreen
)

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class VisionProbe {
	public delegate bool EnumProc(IntPtr h, IntPtr l);
	[StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
	[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
	[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
	[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
	[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
	[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
	[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
	[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
	[DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
	[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
	[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
	[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
}
"@
[void][VisionProbe]::SetProcessDPIAware()

$start = Get-Date
$lines = New-Object System.Collections.Generic.List[string]
function Log([string]$text) {
	$line = "{0,6:N1}s {1}" -f ((Get-Date) - $start).TotalSeconds, $text
	$lines.Add($line); Write-Output $line
}
function Describe([IntPtr]$h) {
	if ($h -eq [IntPtr]::Zero) { return "(none)" }
	$title = New-Object System.Text.StringBuilder 256; [void][VisionProbe]::GetWindowText($h, $title, 256)
	$class = New-Object System.Text.StringBuilder 256; [void][VisionProbe]::GetClassName($h, $class, 256)
	$procId = [uint32]0; [void][VisionProbe]::GetWindowThreadProcessId($h, [ref]$procId)
	$name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
	return "'$title' [$class] $name/$procId"
}
function Flags([int]$ex) {
	$names = @{ 0x8 = "TOPMOST"; 0x20 = "TRANSPARENT(click-through)"; 0x80000 = "LAYERED"; 0x8000000 = "NOACTIVATE"; 0x80 = "TOOLWINDOW" }
	($names.Keys | Sort-Object | Where-Object { $ex -band $_ } | ForEach-Object { $names[$_] }) -join " "
}

$edgeProfile = $null
$browserName = if ($Chrome) { "chrome" } else { "msedge" }
if ($Edge -or $Chrome) {
	$edgeProfile = Join-Path $env:TEMP ("vision-probe-$browserName-" + [guid]::NewGuid())
	$edgeExe = if ($Chrome) { "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" } else { "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" }
	$fs = if ($FullScreen) { " --start-fullscreen" } else { "" }
	Start-Process $edgeExe "--user-data-dir=`"$edgeProfile`" --no-first-run --no-default-browser-check --autoplay-policy=no-user-gesture-required --new-window$fs `"$Url`""
	Start-Sleep -Seconds 3
	Log ("$browserName in front; foreground: " + (Describe ([VisionProbe]::GetForegroundWindow())))
}

$visionPids = @(Get-Process -Name electron, VISION -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$windows = New-Object System.Collections.Generic.List[IntPtr]
[void][VisionProbe]::EnumWindows({ param($h, $l)
	$procId = [uint32]0; [void][VisionProbe]::GetWindowThreadProcessId($h, [ref]$procId)
	if ($visionPids -contains [int]$procId -and [VisionProbe]::IsWindowVisible($h)) { $windows.Add($h) }
	return $true }, [IntPtr]::Zero)
if ($windows.Count -eq 0) { Log "no visible VISION window (is the app running?)" }
foreach ($h in $windows) {
	$r = New-Object VisionProbe+RECT; [void][VisionProbe]::GetWindowRect($h, [ref]$r)
	$ex = [VisionProbe]::GetWindowLong($h, -20)
	Log ("window {0} rect=({1},{2})-({3},{4}) ex=0x{5:X} {6}" -f (Describe $h), $r.L, $r.T, $r.R, $r.B, $ex, (Flags $ex))
}

$quns = 0; [void][VisionProbe]::SHQueryUserNotificationState([ref]$quns)
$qunsNames = @{ 1 = "NOT_PRESENT (screen saver/locked)"; 2 = "BUSY (full-screen app)"; 3 = "RUNNING_D3D_FULL_SCREEN"; 4 = "PRESENTATION_MODE"; 5 = "ACCEPTS_NOTIFICATIONS"; 6 = "QUIET_TIME"; 7 = "APP" }
Log ("notification state: {0} {1}" -f $quns, $qunsNames[$quns])

foreach ($pair in ($Points -split ";" | Where-Object { $_ })) {
	$x, $y = $pair -split ","
	$p = New-Object VisionProbe+POINT; $p.X = [int]$x; $p.Y = [int]$y
	$hit = [VisionProbe]::GetAncestor([VisionProbe]::WindowFromPoint($p), 2)  # GA_ROOT
	Log ("hit-test ({0},{1}) -> {2}" -f $x, $y, (Describe $hit))
}

$last = [IntPtr]::Zero
$end = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
	$fg = [VisionProbe]::GetForegroundWindow()
	if ($fg -ne $last) { Log ("FOREGROUND -> " + (Describe $fg)); $last = $fg }
	Start-Sleep -Milliseconds 200
}

if ($edgeProfile) {
	Get-CimInstance Win32_Process -Filter "Name='$browserName.exe'" |
		Where-Object { $_.CommandLine -like "*$edgeProfile*" } |
		ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
	Start-Sleep -Seconds 1
	Remove-Item -Recurse -Force $edgeProfile -ErrorAction SilentlyContinue
	Log "$browserName closed"
}
Log "done"
$lines | Set-Content -Encoding utf8 $Out
