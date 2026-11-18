// The island window: VISION's small surface at the top (or bottom) of the screen.
// It shows the island page (Next.js static export), served from app://console/ in its own
// session, so its microphone permission never touches Face Control's camera session.
//
// The window is click-through at all times except while its menu is open: a wink on a
// browser tab behind the island reaches the tab. Because it never takes the mouse, the
// main process watches the cursor (20 Hz) and does the rest: the fade when the cursor is
// near, and the 1.5 s dwell that opens the menu.

const { app, BrowserWindow, globalShortcut, ipcMain, net, protocol, screen, session } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
const { createWakeHost } = require('./wake-host.js');
const { createWakeGate } = require('./wake-spotter.js');

const SCHEME = 'app';
const PARTITION = 'persist:assistant';

// What the page draws (px). idle: the resting bar; caption: listening / thinking /
// speaking; line: over a full-screen app; menu: the five-row menu panel.
const SHAPES = {
	idle: { width: 56, height: 8 },
	caption: { width: 360, height: 40 },
	line: { width: 40, height: 3 },
	menu: { width: 320, height: 500 },
};
// The windows that hold them. The island window has room under the bar for the dwell ring.
const WINDOWS = {
	island: { width: 380, height: 80 },
	menu: { width: 340, height: 520 },
};
const POSITIONS = new Set(['top-center', 'top-right', 'bottom-center']);
// Gap between the shape and the screen edge; the line touches the edge.
const EDGE_GAP = 4;
// Shapes sit this far inside the window's side when right-aligned (top right).
const SIDE_PAD = 10;
// Top right stays left of the window caption buttons (minimise, maximise, close).
const CAPTION_BUTTONS = 140;
// At top right the menu opens below a maximised browser's tab strip and address bar.
const BROWSER_BAR = 90;
const FADE_NEAR = 80; // px from the shape: fade to 15 %
const HIT_PAD = 6; // px around the shape that still counts as on it, for the dwell
const DWELL_MS = 1500;
const MENU_IDLE_MS = 8000;
const MENU_AWAY = 200; // px from the menu: it closes
const FULLSCREEN_POLL_MS = 1000;
const POINTER_POLL_MS = 50; // 20 Hz

const normalizePosition = (position) => (POSITIONS.has(position) ? position : 'top-center');

/** Window bounds. kind: 'island' | 'menu' | 'line'. Pure: display = { bounds, workArea }. */
function islandWindowBounds(kind, position, display) {
	position = normalizePosition(position);
	const size = kind === 'menu' ? WINDOWS.menu : WINDOWS.island;
	if (kind === 'line') {
		// Always the very top: a full-screen video keeps its controls at the bottom.
		const { bounds } = display;
		return { x: Math.round(bounds.x + (bounds.width - size.width) / 2), y: bounds.y, ...size };
	}
	const area = display.workArea;
	let x = area.x + (area.width - size.width) / 2;
	if (position === 'top-right') x = area.x + area.width - CAPTION_BUTTONS - size.width;
	let y = area.y;
	if (position === 'bottom-center') y = area.y + area.height - size.height;
	else if (kind === 'menu' && position === 'top-right') y = area.y + BROWSER_BAR;
	return { x: Math.round(x), y: Math.round(y), ...size };
}

/** Screen rect of the visible shape inside a window (the page lays it out the same way). */
function shapeRect(shape, position, win) {
	position = normalizePosition(position);
	const size = SHAPES[shape] || SHAPES.idle;
	const gap = shape === 'line' ? 0 : EDGE_GAP;
	const x = position === 'top-right' && shape !== 'line'
		? win.x + win.width - SIDE_PAD - size.width
		: win.x + (win.width - size.width) / 2;
	const y = position === 'bottom-center' && shape !== 'line' ? win.y + win.height - gap - size.height : win.y + gap;
	return { x: Math.round(x), y: Math.round(y), ...size };
}

/** Distance in px from a point to a rect (0 inside). */
function distanceTo(p, r) {
	const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
	const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
	return Math.hypot(dx, dy);
}

/** The window takes the mouse only while the menu is open. */
const ignoresMouse = (mode) => mode !== 'menu';

/**
 * Dwell to open, measured from the cursor (the window never sees it). The cursor must
 * have been off the island once before a dwell can start, so a pointer already resting
 * where the island appears never opens it, and after the menu opens it must leave again.
 * update() returns { progress 0..1, fire }.
 */
function createDwell(ms = DWELL_MS) {
	let since = null;
	let armed = false;
	return {
		update(over, now) {
			if (!over) {
				since = null;
				armed = true;
				return { progress: 0, fire: false };
			}
			if (!armed) return { progress: 0, fire: false };
			if (since === null) since = now;
			const progress = Math.min(1, (now - since) / ms);
			if (progress < 1) return { progress, fire: false };
			since = null;
			armed = false;
			return { progress: 0, fire: true };
		},
		disarm() {
			since = null;
			armed = false;
		},
	};
}

/** The menu closes after MENU_IDLE_MS with no cursor on it, or when the cursor is far away. */
function menuShouldClose({ cursor, rect, lastOverAt, now }) {
	return distanceTo(cursor, rect) > MENU_AWAY || now - lastOverAt > MENU_IDLE_MS;
}

/** Windows: true while a full-screen app or presentation is in front. Never throws. */
function createFullScreenProbe() {
	// QA runs on a laptop that may have a full-screen app in front.
	if (process.platform !== 'win32' || process.env.VISION_QA_IGNORE_FULLSCREEN === '1') return () => false;
	try {
		const koffi = require('koffi');
		const query = koffi.load('shell32.dll').func('int32 SHQueryUserNotificationState(_Out_ int32* state)');
		return () => {
			const state = [0];
			if (query(state) !== 0) return false;
			// QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN, QUNS_PRESENTATION_MODE
			return state[0] === 2 || state[0] === 3 || state[0] === 4;
		};
	} catch (error) {
		console.warn('[VISION] Full-screen detection unavailable:', error?.message || error);
		return () => false;
	}
}

// Preferred first; if another app already owns a chord, fall back to the next.
const HOTKEY_CANDIDATES = [
	process.env.VISION_HOTKEY,
	'Control+Alt+Space',
	'Control+Shift+Space',
	'Control+Alt+V',
	'Alt+Shift+V',
].filter(Boolean);
const MENU_HOTKEY_CANDIDATES = ['Control+Alt+M', 'Control+Shift+Alt+M'];
const labelFor = (accelerator) => accelerator.replace(/CommandOrControl|Control/g, 'Ctrl');

/** Must run before the app's ready event. */
function registerConsoleScheme() {
	protocol.registerSchemesAsPrivileged([
		{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
	]);
}

/** app://console/<route> -> a file in the static export (`/preview` -> preview.html). */
function resolveConsoleFile(root, urlPath) {
	let rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
	if (!rel || rel.endsWith('/')) rel += 'index.html';
	else if (!path.extname(rel)) rel += '.html';
	const file = path.resolve(root, rel);
	return file.startsWith(path.resolve(root) + path.sep) ? file : null;
}

function registerFirst(candidates, callback, name) {
	for (const accelerator of candidates) {
		try {
			if (globalShortcut.register(accelerator, callback)) {
				console.log(`[VISION] ${name} hotkey: ${labelFor(accelerator)}`);
				return accelerator;
			}
		} catch (error) {
			console.error(`[VISION] Invalid hotkey ${accelerator}:`, error.message);
		}
		console.error(`[VISION] Hotkey ${accelerator} is taken by another app`);
	}
	return null;
}

function createOrbWindow({ preloadPath, iconPath, consoleDir, consoleUrl, getConnectionDetails, onVoiceState, onShowFace, onTogglePause, wakeModelDir, hidden = false }) {
	let win = null;
	// What the page shows: 'idle' | 'caption' | 'menu'. Over a full-screen app idle is a line.
	let mode = 'idle';
	let position = 'top-center';
	let fullScreenApp = false;
	let faceStatus = null;
	const isFullScreenApp = createFullScreenProbe();
	const hotkeys = [];
	let hotkeyLabel = ''; // empty until a candidate registers
	const voiceState = { connected: false, live: false, open: false };
	const gate = createWakeGate();

	const ses = session.fromPartition(PARTITION);
	// Microphone access for LiveKit only.
	ses.setPermissionRequestHandler((_webContents, permission, callback) => {
		callback(permission === 'media' || permission === 'audioCapture');
	});
	ses.setPermissionCheckHandler((_webContents, permission) => permission === 'media' || permission === 'audioCapture');
	if (!ses.protocol.isProtocolHandled(SCHEME)) {
		ses.protocol.handle(SCHEME, (request) => {
			const file = resolveConsoleFile(consoleDir, new URL(request.url).pathname);
			if (!file || !fs.existsSync(file)) return new Response('not found', { status: 404 });
			return net.fetch(pathToFileURL(file).toString());
		});
	}

	const send = (channel, ...args) => win?.webContents.send(channel, ...args);
	const display = () => screen.getPrimaryDisplay();
	const isLine = () => fullScreenApp && mode === 'idle';
	const kind = () => (mode === 'menu' ? 'menu' : isLine() ? 'line' : 'island');
	const shape = () => (mode === 'menu' ? 'menu' : isLine() ? 'line' : mode);

	function activate() {
		if (!win) return;
		if (!win.isVisible()) win.showInactive();
		win.webContents.send('vision-activate');
	}
	function openMenu() {
		if (!win) return;
		if (!win.isVisible()) win.showInactive();
		send('vision-menu', 'open');
	}

	// Click-through everywhere except the open menu.
	let ignoring = null;
	function applyMouse() {
		const ignore = ignoresMouse(mode);
		if (!win || ignore === ignoring) return;
		ignoring = ignore;
		if (ignore) win.setIgnoreMouseEvents(true, { forward: true });
		else {
			win.setIgnoreMouseEvents(false);
			// A resting head pointer sends no further moves, so the menu row under it would
			// never see it arrive. Tell the page where it is.
			const p = screen.getCursorScreenPoint();
			const b = win.getBounds();
			if (distanceTo(p, b) === 0) win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x - b.x, y: p.y - b.y });
		}
	}

	let line = false;
	function layout() {
		if (!win) return;
		if (isLine() !== line) {
			line = isLine();
			send('vision-fullscreen', line);
		}
		win.setBounds(islandWindowBounds(kind(), position, display()), false);
		applyMouse();
	}

	// The cursor, 20 Hz: fade when near, dwell to open, close the menu when left alone.
	const dwell = createDwell();
	let near = null;
	let lastProgress = 0;
	let menuOverAt = 0;
	function pollPointer() {
		if (!win || !win.isVisible()) return;
		const now = Date.now();
		const p = screen.getCursorScreenPoint();
		const bounds = win.getBounds();
		if (mode === 'menu') {
			if (distanceTo(p, bounds) === 0) menuOverAt = now;
			if (menuShouldClose({ cursor: p, rect: bounds, lastOverAt: menuOverAt, now })) {
				menuOverAt = now; // one close request per spell
				send('vision-menu', 'close');
			}
			return;
		}
		const rect = shapeRect(shape(), position, bounds);
		const isNear = distanceTo(p, rect) <= FADE_NEAR;
		if (isNear !== near) {
			near = isNear;
			send('vision-near', isNear);
		}
		const { progress, fire } = dwell.update(distanceTo(p, rect) <= HIT_PAD, now);
		if (progress !== lastProgress) {
			lastProgress = progress;
			send('vision-dwell', progress);
		}
		if (fire) {
			console.log('[VISION] Island dwell: menu');
			openMenu();
		}
	}

	function setMode(next) {
		if (!win || !SHAPES[next] || next === 'line' || next === mode) return;
		const was = mode;
		mode = next;
		if (next === 'menu') menuOverAt = Date.now();
		// Leaving the menu with the cursor still on the island must not reopen it.
		if (was === 'menu') dwell.disarm();
		near = null;
		layout();
	}

	function setVoiceState(state) {
		voiceState.connected = Boolean(state?.connected);
		voiceState.live = Boolean(state?.live);
		voiceState.open = Boolean(state?.open);
		onVoiceState({ connected: voiceState.connected, live: voiceState.live });
	}

	function load() {
		const url = consoleUrl || `${SCHEME}://console/`;
		if (!url.startsWith('http')) {
			win.loadURL(url);
			return;
		}
		// Dev: wait for `next dev` to answer.
		http.get(url, (res) => {
			res.resume();
			win?.loadURL(url);
		}).on('error', () => setTimeout(load, 500));
	}

	win = new BrowserWindow({
		...islandWindowBounds('island', position, display()),
		frame: false,
		transparent: true,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		resizable: false,
		maximizable: false,
		fullscreenable: false,
		backgroundColor: '#00000000',
		// Dwelling on the island must never take keyboard focus from the user's app.
		focusable: false,
		show: false,
		title: 'VISION',
		icon: iconPath,
		webPreferences: {
			preload: preloadPath,
			partition: PARTITION,
			contextIsolation: true,
			nodeIntegration: false,
			backgroundThrottling: false,
			// Dwell activation is not a user gesture; let the agent's voice play anyway.
			autoplayPolicy: 'no-user-gesture-required',
		},
	});
	// Keep the island above regular apps without stealing focus.
	win.setAlwaysOnTop(true, 'screen-saver');
	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	applyMouse();
	win.on('show', () => dwell.disarm());
	win.webContents.once('did-finish-load', () => {
		if (win && !hidden) win.showInactive();
	});
	// QA runs stay silent: the cue sounds still play (and log) but reach no speaker.
	if (process.env.VISION_QA_SILENT === '1') win.webContents.setAudioMuted(true);
	win.webContents.on('console-message', (event, _level, legacyMessage) => {
		const message = event?.message ?? legacyMessage;
		if (typeof message === 'string' && message.startsWith('[VISION] sound ')) console.log(message);
	});
	// A reloaded page starts from scratch: tell it again what it can't ask for.
	win.webContents.on('did-finish-load', () => {
		mode = 'idle';
		layout();
		send('vision-fullscreen', line);
		if (faceStatus) send('vision-face-status', faceStatus);
	});
	// A crashed or frozen renderer would leave a dead island that only a hand could fix.
	win.webContents.on('render-process-gone', (_event, details) => {
		console.error('[VISION] Island renderer gone:', details.reason, '- reloading');
		if (details.reason !== 'clean-exit') setTimeout(() => win?.webContents.reload(), 500);
	});
	win.on('unresponsive', () => {
		console.error('[VISION] Island renderer unresponsive - reloading');
		win?.webContents.forcefullyCrashRenderer();
	});
	win.on('closed', () => {
		win = null;
		setVoiceState({ connected: false, live: false, open: false });
	});
	load();
	const talk = registerFirst(HOTKEY_CANDIDATES, activate, 'Talk');
	if (talk) {
		hotkeys.push(talk);
		hotkeyLabel = labelFor(talk);
	}
	const menuKey = registerFirst(MENU_HOTKEY_CANDIDATES, openMenu, 'Menu');
	if (menuKey) hotkeys.push(menuKey);

	const fromOrb = (event) => win && event.sender === win.webContents;
	ipcMain.on('vision-mode', (event, next) => fromOrb(event) && setMode(next));
	ipcMain.on('vision-position', (event, next) => {
		if (!fromOrb(event) || normalizePosition(next) === position) return;
		position = normalizePosition(next);
		layout();
	});
	ipcMain.on('vision-show-face', (event) => fromOrb(event) && onShowFace?.());
	ipcMain.on('vision-toggle-pause', (event) => fromOrb(event) && onTogglePause?.());
	ipcMain.handle('vision-hotkey', () => hotkeyLabel);
	ipcMain.handle('vision-one-app', () => true);
	ipcMain.on('vision-hide', (event) => fromOrb(event) && win.hide());
	ipcMain.on('vision-quit', (event) => fromOrb(event) && app.quit());
	// { connected, live, open }: live = the mic is open; open = a voice session is showing.
	ipcMain.on('vision-voice-state', (event, state) => fromOrb(event) && setVoiceState(state));
	ipcMain.handle('vision-connection-details', (event, options) => {
		if (!fromOrb(event)) throw new Error('not allowed');
		console.log('[VISION] Voice session token requested');
		return getConnectionDetails({ agentName: typeof options?.agentName === 'string' ? options.agentName : undefined });
	});
	// Wake phrase: the island page streams mic audio here; the spotter runs in a utility
	// process, and the gate decides what each keyword does.
	const wake = wakeModelDir
		? createWakeHost({
			modelDir: wakeModelDir,
			onHeard: (heard) => {
				if (!win) return;
				const action = gate.decide(heard, { open: voiceState.open });
				const why = !heard.ok ? 'rejected: part of a longer word' : voiceState.open && action === 'ignore' ? 'ignored: voice is already on' : action;
				console.log(`[VISION] Wake word: ${heard.keyword} (${why})`);
				if (action === 'ignore') return;
				if (!win.isVisible()) win.showInactive();
				send('vision-wake', { ...heard, action });
			},
		})
		: null;
	let wakeAudioSeen = false;
	ipcMain.on('vision-wake-audio', (event, samples, end) => {
		if (!fromOrb(event)) return;
		if (!wakeAudioSeen) {
			wakeAudioSeen = true;
			console.log('[VISION] Wake word mic streaming');
		}
		wake?.audio(samples, end);
	});
	ipcMain.on('vision-wake-sound', (event, ms) => {
		if (fromOrb(event) && Number.isFinite(ms)) console.log(`[VISION] Wake sound ${Math.round(ms)} ms after the spotter's chunk`);
	});
	ipcMain.on('vision-wake-sensitivity', (event, value) => fromOrb(event) && wake?.setSensitivity(value));
	ipcMain.on('vision-wake-phrase', (event, phrase) => {
		if (!fromOrb(event) || phrase === gate.phrase) return;
		gate.setPhrase(phrase);
		console.log(`[VISION] Wake phrase: ${gate.phrase === 'vision' ? 'Vision' : 'Hey Vision'}`);
	});
	// Heartbeat: Face Control treats a silent assistant as voice off.
	const heartbeat = setInterval(() => onVoiceState({ connected: voiceState.connected, live: voiceState.live }), 4000);
	heartbeat.unref();
	const fullScreenPoll = setInterval(() => {
		const now = isFullScreenApp();
		if (now === fullScreenApp) return;
		fullScreenApp = now;
		console.log(`[VISION] Full-screen app ${now ? 'in front: the island becomes a line at the top' : 'gone'}`);
		layout();
	}, FULLSCREEN_POLL_MS);
	fullScreenPoll.unref();
	const pointerPoll = setInterval(pollPointer, POINTER_POLL_MS);
	pointerPoll.unref();

	return {
		activate,
		openMenu,
		show: () => win?.showInactive(),
		hide: () => win?.hide(),
		getHotkeyLabel: () => hotkeyLabel,
		/** { tracking, seen, eyesResume } from Face Control. */
		setFaceStatus: (status) => {
			faceStatus = status;
			send('vision-face-status', status);
		},
		getWindow: () => win,
		/** For QA probes: what the window is doing now. */
		getState: () => ({ mode, position, line, ignoring, near, bounds: win?.getBounds(), shape: win && shapeRect(shape(), position, win.getBounds()) }),
		destroy: () => {
			clearInterval(heartbeat);
			clearInterval(fullScreenPoll);
			clearInterval(pointerPoll);
			wake?.stop();
			for (const accelerator of hotkeys) globalShortcut.unregister(accelerator);
			win?.destroy();
		},
	};
}

module.exports = {
	createOrbWindow, registerConsoleScheme, resolveConsoleFile,
	islandWindowBounds, shapeRect, distanceTo, ignoresMouse, createDwell, menuShouldClose,
	SHAPES, WINDOWS, FADE_NEAR, HIT_PAD, DWELL_MS, MENU_IDLE_MS, MENU_AWAY, CAPTION_BUTTONS, BROWSER_BAR,
};
