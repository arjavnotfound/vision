// Main window creation (new frameless UI or the classic one) and the --preview runner
// used for design QA screenshots.

const { BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');

const NEW_UI_PAGE = 'src/ui/index.html';
// VISION mark (Landolt C): .ico on Windows for crisp taskbar/title icons, PNG elsewhere.
const NEW_UI_ICON = path.join(__dirname, '../../images/vision', process.platform === 'win32' ? 'vision.ico' : 'vision-app-icon-512.png');
const LEGACY_PAGE = 'src/electron-app.html';
const OVERLAY_PREVIEW_PAGE = 'src/overlay/preview.html';

function createAppWindow({ legacy, preloadPath, iconPath, windowStateKeeper, screen, syntheticFace = false, kiosk = false }) {
	const webPreferences = {
		preload: preloadPath,
		// Disable throttling of animations and timers so the mouse control can still work when minimized.
		backgroundThrottling: false,
	};

	if (legacy) {
		// Classic research UI in a standard window (native frame + native menu bar).
		const state = windowStateKeeper({ defaultWidth: 750, defaultHeight: 700 });
		const win = new BrowserWindow({
			x: state.x,
			y: state.y,
			width: state.width,
			height: state.height,
			backgroundColor: '#0d1117',
			webPreferences,
			icon: iconPath,
		});
		win.loadFile(LEGACY_PAGE);
		win._visionWindowState = state;
		return win;
	}

	// "The Instrument": frameless, about 1200x780, never larger than the work area
	// (school laptops are often 1366x768).
	const work = screen.getPrimaryDisplay().workAreaSize;
	const state = windowStateKeeper({
		file: 'window-state-face-v1.json',
		defaultWidth: Math.min(1200, work.width),
		defaultHeight: Math.min(780, work.height),
	});
	// Quiet mode (VISION_QUIET=1, used by CHECK.bat): start minimised, silent, no focus.
	const quiet = kiosk && process.env.VISION_QUIET === '1';
	const win = new BrowserWindow({
		show: !quiet,
		x: state.x,
		y: state.y,
		width: Math.min(state.width, work.width),
		height: Math.min(state.height, work.height),
		minWidth: 980,
		minHeight: 620,
		frame: false,
		title: 'VISION',
		backgroundColor: '#0B0A09',
		webPreferences,
		icon: NEW_UI_ICON,
	});
	// The page <title> would otherwise replace the window title.
	win.on('page-title-updated', (event) => event.preventDefault());
	const query = {};
	if (syntheticFace) query.synthetic = '1';
	if (kiosk) query.kiosk = '1';
	if (quiet) {
		query.quiet = '1';
		// Minimised from the start: it shows in the taskbar but never covers the screen.
		win.minimize();
	} else if (kiosk) {
		// One-app mode: the Start screen fills the screen.
		win.maximize();
	}
	win.loadFile(NEW_UI_PAGE, Object.keys(query).length ? { query } : undefined);
	win._visionWindowState = state;
	return win;
}

/** Every screen and state, for `--preview --screenshot-all <dir>`. */
const PREVIEW_JOBS = [
	{ name: 'main-tracking-ember', query: { scene: 'tracking', theme: 'ember' } },
	{ name: 'main-tracking-paper', query: { scene: 'tracking', theme: 'paper' } },
	{ name: 'main-paused', query: { scene: 'paused' } },
	{ name: 'main-no-face', query: { scene: 'no-face' } },
	{ name: 'main-low-light', query: { scene: 'low-light' } },
	{ name: 'main-framing-hint', query: { scene: 'framing' } },
	{ name: 'main-gesture-wink', query: { scene: 'gesture' } },
	{ name: 'main-gesture-mouth-paper', query: { scene: 'gesture-mouth', theme: 'paper' } },
	{ name: 'main-dwell-ring', query: { scene: 'dwell' } },
	{ name: 'main-camera-error', query: { scene: 'camera-error' } },
	{ name: 'main-compact-1280x720', query: { scene: 'tracking' }, size: [1280, 720] },
	{ name: 'calib-1-center', query: { scene: 'tracking', view: 'calib-center' } },
	{ name: 'calib-2-range', query: { scene: 'range', view: 'calib-range' } },
	{ name: 'calib-2-range-paper', query: { scene: 'range', view: 'calib-range', theme: 'paper' } },
	{ name: 'calib-3-gestures', query: { scene: 'gesture-mouth', view: 'calib-gestures' } },
	{ name: 'calib-4-done', query: { scene: 'tracking', view: 'calib-done' } },
	{ name: 'onboarding-1-welcome', query: { scene: 'tracking', view: 'onboarding-1' } },
	{ name: 'onboarding-2-camera', query: { scene: 'framing', view: 'onboarding-2' } },
	{ name: 'onboarding-3-calibrate', query: { scene: 'tracking', view: 'onboarding-3' } },
	{ name: 'onboarding-1-welcome-paper', query: { scene: 'tracking', view: 'onboarding-1', theme: 'paper' } },
	{ name: 'sheet-settings', query: { scene: 'tracking', view: 'settings' } },
	{ name: 'sheet-profiles', query: { scene: 'tracking', view: 'profiles' } },
	{ name: 'sheet-about', query: { scene: 'tracking', view: 'about' } },
	{ name: 'dialog-quit', query: { scene: 'tracking', view: 'confirm' } },
	{ name: 'overlay-tracking', page: OVERLAY_PREVIEW_PAGE, query: { state: 'tracking' }, rect: { x: 400, y: 160, width: 440, height: 260 } },
	{ name: 'overlay-dwell', page: OVERLAY_PREVIEW_PAGE, query: { state: 'dwell' }, rect: { x: 400, y: 160, width: 440, height: 260 } },
	{ name: 'overlay-click', page: OVERLAY_PREVIEW_PAGE, query: { state: 'click' }, rect: { x: 400, y: 160, width: 440, height: 260 } },
	{ name: 'overlay-drag', page: OVERLAY_PREVIEW_PAGE, query: { state: 'drag' }, rect: { x: 400, y: 160, width: 440, height: 260 } },
	{ name: 'overlay-paused', page: OVERLAY_PREVIEW_PAGE, query: { state: 'paused' }, rect: { x: 400, y: 160, width: 440, height: 260 } },
	{ name: 'overlay-no-face', page: OVERLAY_PREVIEW_PAGE, query: { state: 'no-face' }, rect: { x: 400, y: 160, width: 440, height: 260 } },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createPreviewRunner({ args, preloadPath }) {
	const first = (value) => Array.isArray(value) ? value[0] : value;

	async function waitForReady(win) {
		for (let i = 0; i < 200; i++) {
			try {
				if (await win.webContents.executeJavaScript('window.__visionReady === true')) {
					return;
				}
			} catch (_error) {
				// page still loading
			}
			await sleep(50);
		}
		console.warn('[preview] page did not report ready; capturing anyway');
	}

	async function capture(win, job, outPath) {
		const [width, height] = job.size ?? [1200, 780];
		win.setContentSize(width, height);
		const query = { preview: '1', freeze: '1', ...job.query };
		await win.loadFile(job.page ?? NEW_UI_PAGE, { query });
		await waitForReady(win);
		await sleep(450);
		const image = await win.webContents.capturePage(job.rect);
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		fs.writeFileSync(outPath, image.toPNG());
		console.log(`[preview] wrote ${outPath}`);
	}

	return {
		async start() {
			const win = new BrowserWindow({
				width: 1200,
				height: 780,
				useContentSize: true,
				frame: false,
				resizable: true,
				backgroundColor: '#0B0A09',
				title: 'VISION · Preview',
				icon: NEW_UI_ICON,
				webPreferences: { preload: preloadPath, backgroundThrottling: false },
			});
			const all = first(args.screenshot_all);
			const single = first(args.screenshot);
			try {
				if (all) {
					const only = first(args.only);
					for (const job of PREVIEW_JOBS) {
						if (only && !job.name.includes(only)) continue;
						await capture(win, job, path.join(path.resolve(all), `${job.name}.png`));
					}
				} else {
					const query = {};
					for (const key of ['scene', 'view', 'theme', 'state']) {
						if (args[key]) query[key] = first(args[key]);
					}
					const job = { query, page: query.state ? OVERLAY_PREVIEW_PAGE : undefined };
					if (single) {
						await capture(win, job, path.resolve(single));
					} else {
						await win.loadFile(job.page ?? NEW_UI_PAGE, { query: { preview: '1', ...query } });
					}
				}
			} catch (error) {
				console.error('[preview] failed:', error);
				process.exitCode = 1;
			}
			if ((all || single) && args.exit_after_screenshot) {
				app.quit();
			}
		},
	};
}

module.exports = { createAppWindow, createPreviewRunner, PREVIEW_JOBS };
