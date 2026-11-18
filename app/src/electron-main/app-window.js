// Main window creation and the --preview runner
// used for design QA screenshots.

const { BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');

const NEW_UI_PAGE = 'src/ui/index.html';
// VISION mark (Landolt C): .ico on Windows for crisp taskbar/title icons, PNG elsewhere.
const NEW_UI_ICON = path.join(__dirname, '../../images/vision', process.platform === 'win32' ? 'vision.ico' : 'vision-app-icon-512.png');
const OVERLAY_PREVIEW_PAGE = 'src/overlay/preview.html';

/**
 * How the face window opens. `kiosk`: the hands-free UI (spoken help, no native dialogs).
 * `start`: the Start screen and calibration (first run only). `hidden`: straight to the
 * tray, which needs tracking on at launch or the user has nothing to work with.
 * VISION_ONE_APP=1 keeps the old full-screen Start screen on every launch.
 */
function planLaunch({ firstRun, assistant, oneAppEnv, startEnabled }) {
	const forced = oneAppEnv === '1';
	return {
		kiosk: assistant || forced,
		start: firstRun || forced,
		maximize: forced,
		hidden: assistant && !firstRun && !forced && startEnabled === true,
	};
}

function createAppWindow({ preloadPath, windowStateKeeper, screen, syntheticFace = false, kiosk = false, start = false, maximize = false, hidden = false }) {
	const webPreferences = {
		preload: preloadPath,
		// Disable throttling of animations and timers so the mouse control can still work when minimized.
		backgroundThrottling: false,
	};

	// The VISION window: frameless, about 1200x780, never larger than the work area
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
		show: !quiet && !hidden,
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
	if (start) query.start = '1';
	// QA runs: no speaker audio; spoken lines are still logged as [speak].
	if (process.env.VISION_QA_SILENT === '1') query.quiet = '1';
	if (quiet) {
		query.quiet = '1';
		// Minimised from the start: it shows in the taskbar but never covers the screen.
		win.minimize();
	} else if (maximize) {
		win.maximize();
	}
	// With backgroundThrottling off the page always reports itself visible, so tell it
	// when the window is off screen: it stops drawing, tracking keeps running.
	const sendShown = () => win.webContents.send('windowShown', win.isVisible() && !win.isMinimized());
	for (const event of ['show', 'hide', 'minimize', 'restore']) win.on(event, sendShown);
	win.webContents.on('did-finish-load', sendShown);
	// Spoken lines reach the main log (QA asserts on them; no speaker needed).
	win.webContents.on('console-message', (event, _level, legacyMessage) => {
		const message = event?.message ?? legacyMessage;
		if (typeof message === 'string' && (message.startsWith('[speak]') || message.startsWith('[first-run]'))) console.log(message);
	});
	win.loadFile(NEW_UI_PAGE, Object.keys(query).length ? { query } : undefined);
	win._visionWindowState = state;
	return win;
}

/** Every screen and state, for `--preview --screenshot-all <dir>`. */
const PREVIEW_JOBS = [
	{ name: 'home', query: { scene: 'tracking', view: 'home' } },
	{ name: 'home-paused', query: { scene: 'paused', view: 'home' } },
	{ name: 'home-no-keys', query: { scene: 'tracking', view: 'home', nokeys: '1' } },
	{ name: 'home-paper', query: { scene: 'tracking', view: 'home', theme: 'paper' } },
	{ name: 'face', query: { scene: 'gesture', view: 'face' } },
	{ name: 'face-no-face', query: { scene: 'no-face', view: 'face' } },
	{ name: 'face-camera-error', query: { scene: 'camera-error', view: 'face' } },
	{ name: 'voice', query: { scene: 'tracking', view: 'voice', activity: '1' } },
	{ name: 'voice-no-keys', query: { scene: 'tracking', view: 'voice', nokeys: '1' } },
	{ name: 'voice-offline', query: { scene: 'tracking', view: 'voice', voice: 'offline' } },
	{ name: 'voice-bad-key', query: { scene: 'tracking', view: 'voice', voice: 'badkey' } },
	{ name: 'settings-1-clicking-1280x720', query: { scene: 'tracking', view: 'settings', section: 'clicking' }, size: [1280, 720] },
	{ name: 'settings-2-cursor-1280x720', query: { scene: 'tracking', view: 'settings', section: 'cursor' }, size: [1280, 720] },
	{ name: 'settings-3-voice-1280x720', query: { scene: 'tracking', view: 'settings', section: 'voice' }, size: [1280, 720] },
	{ name: 'settings-3b-voice-no-keys-1280x720', query: { scene: 'tracking', view: 'settings', section: 'voice', nokeys: '1' }, size: [1280, 720] },
	{ name: 'settings-3c-voice-keys-open-1280x720', query: { scene: 'tracking', view: 'settings', section: 'voice', keys: 'open' }, size: [1280, 720] },
	{ name: 'settings-4-display-1280x720', query: { scene: 'tracking', view: 'settings', section: 'display' }, size: [1280, 720] },
	{ name: 'settings-5-about-1280x720', query: { scene: 'tracking', view: 'about' }, size: [1280, 720] },
	{ name: 'settings-reset-confirm', query: { scene: 'tracking', view: 'settings', section: 'clicking', reset: '1' } },
	{ name: 'settings-clicking-paper', query: { scene: 'tracking', view: 'settings', section: 'clicking', theme: 'paper' } },
	{ name: 'help', query: { scene: 'tracking', view: 'help' } },
	{ name: 'diagnostics', query: { scene: 'gesture', view: 'diagnostics' } },
	{ name: 'dialog-quit', query: { scene: 'tracking', view: 'quit' } },
	{ name: 'calib-1-center', query: { scene: 'tracking', view: 'calib-center' } },
	{ name: 'calib-3-done', query: { scene: 'tracking', view: 'calib-done' } },
	{ name: 'onboarding-1-welcome', query: { scene: 'tracking', view: 'onboarding-1' } },
	{ name: 'home-1280x720', query: { scene: 'tracking', view: 'home' }, size: [1280, 720] },
	{ name: 'home-980x620', query: { scene: 'tracking', view: 'home' }, size: [980, 620] },
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

	// Offscreen windows do not lay out again after a resize, so each size gets its own window.
	function makeWindow([width, height]) {
		return new BrowserWindow({
			width,
			height,
			useContentSize: true,
			frame: false,
			resizable: true,
			backgroundColor: '#0B0A09',
			title: 'VISION · Preview',
			icon: NEW_UI_ICON,
			// QA screenshots come from capturePage: render offscreen, never on the desktop.
			webPreferences: { preload: preloadPath, backgroundThrottling: false, offscreen: true },
			show: false,
			skipTaskbar: true,
		});
	}
	const windows = new Map();
	const windowFor = (size = [1200, 780]) => {
		const key = size.join('x');
		if (!windows.has(key)) windows.set(key, makeWindow(size));
		return windows.get(key);
	};

	async function capture(job, outPath) {
		const win = windowFor(job.size);
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
			const all = first(args.screenshot_all);
			const single = first(args.screenshot);
			try {
				if (all) {
					const only = first(args.only);
					for (const job of PREVIEW_JOBS) {
						if (only && !job.name.includes(only)) continue;
						await capture(job, path.join(path.resolve(all), `${job.name}.png`));
					}
				} else {
					const query = {};
					for (const key of ['scene', 'view', 'section', 'theme', 'state']) {
						if (args[key]) query[key] = first(args[key]);
					}
					const job = { query, page: query.state ? OVERLAY_PREVIEW_PAGE : undefined };
					if (single) {
						await capture(job, path.resolve(single));
					} else {
						await windowFor().loadFile(job.page ?? NEW_UI_PAGE, { query: { preview: '1', ...query } });
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

module.exports = { createAppWindow, createPreviewRunner, planLaunch, PREVIEW_JOBS };
