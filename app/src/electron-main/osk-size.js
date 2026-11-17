// Windows On-Screen Keyboard (osk.exe) at a size a head pointer can hit: keys of at least
// 64 px, docked to the bottom of the screen. osk.exe reads its window from the registry
// when it starts, so the launch command writes it first.

// About 19 key widths across and 5 rows plus the title bar (default layout, no number pad).
const MIN_WIDTH = 1280;
const MIN_HEIGHT = 400;

/** Physical-pixel work area -> osk window. */
function oskBounds(workArea) {
	const width = Math.min(workArea.width, Math.max(MIN_WIDTH, Math.round(workArea.width * 0.9)));
	const height = Math.min(Math.round(workArea.height * 0.5), Math.max(MIN_HEIGHT, Math.round(workArea.height * 0.42)));
	return {
		left: workArea.x + Math.round((workArea.width - width) / 2),
		top: workArea.y + workArea.height - height,
		width,
		height,
	};
}

/** PowerShell that sizes osk.exe on an Electron display, then starts it. */
function oskLaunchCommand({ workArea, scaleFactor = 1 }) {
	const px = (n) => Math.round(n * scaleFactor);
	const b = oskBounds({ x: px(workArea.x), y: px(workArea.y), width: px(workArea.width), height: px(workArea.height) });
	const key = 'HKCU:\\Software\\Microsoft\\Osk';
	const values = { WindowLeft: b.left, WindowTop: b.top, WindowWidth: b.width, WindowHeight: b.height };
	const sets = Object.entries(values)
		.map(([name, value]) => `Set-ItemProperty -Path $k -Name ${name} -Type DWord -Value ${value | 0}`)
		.join('; ');
	// Sizing is best effort: osk.exe still opens if the registry write fails.
	return `try { $k = '${key}'; if (-not (Test-Path $k)) { New-Item -Path $k | Out-Null }; ${sets} } catch {}; Start-Process osk.exe`;
}

module.exports = { oskBounds, oskLaunchCommand };
