// The island over a browser tab, invisibly: proves a click on the tab behind the island
// reaches the tab, and that only the open menu takes the mouse.
//
//   app\node_modules\.bin\electron scripts\qa\island-overlap-probe.js [evidence dir]
//
// A stand-in tab strip window sits under the island across the top of the primary screen.
// Both windows are at 1 % opacity, so nothing shows on screen; Windows' hit test ignores
// off-screen windows, so they have to be on it. Windows' own hit test (WindowFromPoint) says which window a
// wink click at the island's spot would land on, and a click posted there must reach the
// tab page. The cursor is faked too (fade, dwell ring, menu), so the real mouse never moves.
// Needs a built console (`pnpm build` in console/). Exit code 1 if a check fails.
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');
const appRequire = (name) => require(path.join(ROOT, 'app', 'node_modules', name));
const { app, BrowserWindow, screen } = require('electron');
const koffi = appRequire('koffi');

const OUT = process.argv.find((arg, i) => i > 1 && !arg.startsWith('-') && !arg.endsWith('.js'));
let cursor = { x: 0, y: 0 };

process.env.VISION_QA_IGNORE_FULLSCREEN = '1';
process.env.VISION_QA_SILENT = '1';
process.env.VISION_HOTKEY = 'Control+Shift+Alt+F12'; // never steal the owner's chords
const orbModule = require(path.join(ROOT, 'app/src/electron-main/orb-window.js'));

const user32 = koffi.load('user32.dll');
koffi.struct('POINT', { x: 'long', y: 'long' });
const WindowFromPoint = user32.func('intptr __stdcall WindowFromPoint(POINT pt)');
const GetAncestor = user32.func('intptr __stdcall GetAncestor(intptr hwnd, uint32 flags)');
const PostMessageW = user32.func('bool __stdcall PostMessageW(intptr hwnd, uint32 msg, uintptr wParam, intptr lParam)');
const ScreenToClient = user32.func('bool __stdcall ScreenToClient(intptr hwnd, _Inout_ POINT* pt)');
const GetWindowLongW = user32.func('long __stdcall GetWindowLongW(intptr hwnd, int index)');
const hwndOf = (win) => BigInt(win.getNativeWindowHandle().readBigUInt64LE(0));
const topAt = (p) => BigInt(GetAncestor(WindowFromPoint(p), 2)); // GA_ROOT
const WS_EX_TRANSPARENT = 0x20;

const results = [];
const record = (name, ok, detail = '') => {
	results.push({ name, ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, ms = 8000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await fn()) return true;
		await wait(50);
	}
	return false;
}

orbModule.registerConsoleScheme();
app.whenReady().then(async () => {
	const { workArea } = screen.getPrimaryDisplay();
	cursor = { x: workArea.x + 100, y: workArea.y + workArea.height - 100 };
	screen.getCursorScreenPoint = () => ({ ...cursor });
	// The stand-in browser: a tab strip across the top of the fake screen.
	const tab = new BrowserWindow({
		x: workArea.x, y: workArea.y, width: workArea.width, height: 120, frame: false, show: false, focusable: false, skipTaskbar: true, opacity: 0.01,
		webPreferences: { backgroundThrottling: false },
	});
	await tab.loadURL(`data:text/html,${encodeURIComponent(`<body style="margin:0;background:#dfe3e8;font:14px sans-serif">
		<div id="tabs" style="height:40px;display:flex;gap:2px;padding:4px 8px 0">${Array.from({ length: 9 }, (_, i) => `<div style="flex:1;background:#fff;border-radius:8px 8px 0 0;padding:10px">Tab ${i + 1}</div>`).join('')}</div>
		<script>window.clicks = []; addEventListener('mousedown', (e) => clicks.push([e.clientX, e.clientY]));</script></body>`)}`);
	tab.showInactive();

	const orb = orbModule.createOrbWindow({
		preloadPath: path.join(ROOT, 'app/src/preload-orb.js'),
		consoleDir: path.join(ROOT, 'console', 'out'),
		getConnectionDetails: async () => { throw new Error('no voice in the probe'); },
		onVoiceState: () => undefined,
	});
	const win = orb.getWindow();
	win.setOpacity(0.01); // capturePage still sees the page
	await until(() => win.isVisible(), 15000);
	await wait(800);
	const state = orb.getState();
	const bar = state.shape;
	const spot = { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
	record('idle island is a 56x8 bar at top centre', bar.width === 56 && bar.height === 8 && Math.abs(spot.x - (workArea.x + workArea.width / 2)) <= 1 && bar.y === workArea.y + 4, JSON.stringify(bar));
	const exStyle = GetWindowLongW(hwndOf(win), -20);
	record('idle window is click-through (WS_EX_TRANSPARENT)', (exStyle & WS_EX_TRANSPARENT) !== 0, `ex style 0x${(exStyle >>> 0).toString(16)}`);

	const tabHwnd = hwndOf(tab);
	const orbHwnd = hwndOf(win);
	const hit = topAt(spot);
	record('a click on the island spot hits the tab behind it', hit === tabHwnd, `hit ${hit}, tab ${tabHwnd}, island ${orbHwnd}`);

	// The click a wink makes there: posted to whatever window Windows says is under it.
	const target = WindowFromPoint(spot);
	const client = { x: spot.x, y: spot.y };
	ScreenToClient(target, client);
	const lParam = (client.y << 16) | (client.x & 0xffff);
	PostMessageW(target, 0x0201, 1, lParam); // WM_LBUTTONDOWN
	PostMessageW(target, 0x0202, 0, lParam); // WM_LBUTTONUP
	const clicked = await until(async () => (await tab.webContents.executeJavaScript('clicks.length')) > 0, 3000);
	const where = await tab.webContents.executeJavaScript('JSON.stringify(clicks)');
	record('the wink click reaches the tab page', clicked, `tab saw mousedown at ${where}`);

	const shot = async (name) => {
		if (!OUT) return;
		fs.mkdirSync(OUT, { recursive: true });
		const image = await win.webContents.capturePage();
		fs.writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
	};
	await shot('probe-idle');

	// Near: fade. The renderer eases opacity to 0.15.
	const opacity = () => win.webContents.executeJavaScript(`(() => { const el = document.querySelector('[role=img]')?.parentElement; return el ? Number(getComputedStyle(el).opacity) : -1; })()`);
	cursor = { x: spot.x, y: bar.y + bar.height + 60 };
	const faded = await until(async () => (await opacity()) < 0.2, 3000);
	record('fades to about 15 % with the cursor 60 px away', faded, `opacity ${await opacity()}`);
	await shot('probe-faded-near-cursor');
	cursor = { x: spot.x, y: bar.y + 300 };
	const back = await until(async () => (await opacity()) > 0.95, 3000);
	record('comes back when the cursor leaves', back);

	// Passing over for under 1.5 s opens nothing.
	cursor = { ...spot };
	await wait(1000);
	cursor = { x: spot.x, y: bar.y + 300 };
	await wait(300);
	record('passing over the island opens nothing', orb.getState().mode === 'idle', `mode ${orb.getState().mode}`);

	// Dwell: ring fills, menu opens at 1.5 s, and only then does the window take the mouse.
	cursor = { ...spot };
	await wait(800);
	const ring = await win.webContents.executeJavaScript(`Boolean(document.querySelector('svg circle[stroke="var(--ember)"]'))`);
	record('the fill ring shows during the dwell', ring);
	await shot('probe-dwell-ring');
	const opened = await until(() => orb.getState().mode === 'menu', 2500);
	record('a 1.5 s dwell opens the menu', opened);
	await wait(400);
	const menuState = orb.getState();
	record('the open menu takes the mouse', menuState.ignoring === false && topAt(spot) === orbHwnd, `ignoring ${menuState.ignoring}`);
	const rows = await win.webContents.executeJavaScript(`[...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent.trim())`);
	record('menu rows: Talk, Pause, Settings, Diagnostics, Help, Close', ['Talk', 'Pause face control', 'Settings', 'Diagnostics', 'Help', 'Close'].every((r) => rows.includes(r)), rows.join(', '));
	await shot('probe-menu');

	// Cursor far away: the menu closes and the island is click-through again.
	cursor = { x: spot.x + 600, y: spot.y + 500 };
	const closed = await until(() => orb.getState().mode === 'idle', 3000);
	record('the menu closes when the cursor is 200 px away', closed);
	await wait(300);
	record('click-through again after the menu closes', orb.getState().ignoring === true && topAt(spot) === tabHwnd);

	// The menu hotkey path (same open call).
	orb.openMenu();
	record('the menu hotkey opens the menu', await until(() => orb.getState().mode === 'menu', 2000));
	cursor = { x: spot.x + 100, y: spot.y + 100 };
	await win.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close')?.click()`);
	record('Close closes the menu', await until(() => orb.getState().mode === 'idle', 2000));

	if (OUT) fs.writeFileSync(path.join(OUT, 'overlap-probe.json'), JSON.stringify(results, null, '\t'));
	const failed = results.filter((r) => !r.ok).length;
	console.log(`${results.length - failed}/${results.length} passed`);
	orb.destroy();
	tab.destroy();
	app.exit(failed ? 1 : 0);
}).catch((error) => {
	console.error(error);
	app.exit(1);
});
