// The voice assistant's orb / strip / console window (was a second Electron app).
// It shows the console (Next.js static export), served from app://console/ in its own
// session, so its microphone permission never touches Face Control's camera session.

const { app, BrowserWindow, globalShortcut, ipcMain, net, protocol, screen, session } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');

const SCHEME = 'app';
const PARTITION = 'persist:assistant';

// The renderer draws each surface centred inside a window of exactly this size.
const MODE_BOUNDS = {
	// Orb column: [hint 34] 12 [orb 68] 12 [chip 32] + margins.
	orb: { width: 112, height: 182 },
	// Orb + its hover hint label. Bottom-anchored, so the disc does not move.
	'orb-hint': { width: 380, height: 182 },
	strip: { width: 640, height: 182 },
	console: { width: 1200, height: 780 },
};
const BOTTOM_MARGIN = 12;
// Over a full-screen app the resting orb shrinks to this scale at the right edge, away
// from the video controls at the bottom centre, and ignores the mouse.
const MARKER_SCALE = 0.4;
const FULLSCREEN_POLL_MS = 1000;
const POINTER_POLL_MS = 50;

/** Windows: true while a full-screen app or presentation is in front. Never throws. */
function createFullScreenProbe() {
	if (process.platform !== 'win32') return () => false;
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

function getBoundsForMode(mode) {
	const { workArea } = screen.getPrimaryDisplay();
	const size = MODE_BOUNDS[mode] || MODE_BOUNDS.orb;
	// The console is centred. The orb/strip windows are RIGHT-anchored where the resting
	// orb window's right edge sits, so the strip grows to the left and the mark stays put.
	const orbRight = workArea.x + workArea.width / 2 + MODE_BOUNDS.orb.width / 2;
	const x = Math.round(mode === 'console' ? workArea.x + (workArea.width - size.width) / 2 : orbRight - size.width);
	const y = mode === 'console'
		? Math.round(workArea.y + (workArea.height - size.height) / 2)
		: Math.round(workArea.y + workArea.height - size.height - BOTTOM_MARGIN);
	return { x, y, ...size };
}

function createOrbWindow({ preloadPath, iconPath, consoleDir, consoleUrl, getConnectionDetails, onVoiceState, hidden = false }) {
	let win = null;
	let mode = 'orb';
	let marker = false; // the small full-screen marker is showing
	let fullScreenApp = false;
	const isFullScreenApp = createFullScreenProbe();
	let hotkey = null;
	let hotkeyLabel = ''; // empty until a candidate registers
	const voiceState = { connected: false, live: false };

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

	function activate() {
		if (!win) return;
		if (!win.isVisible()) win.showInactive();
		// The renderer opens the strip, which also brings the orb back from the marker.
		win.webContents.send('vision-activate');
	}

	function registerHotkey() {
		for (const accelerator of HOTKEY_CANDIDATES) {
			try {
				if (globalShortcut.register(accelerator, activate)) {
					hotkey = accelerator;
					hotkeyLabel = labelFor(accelerator);
					console.log(`[VISION] Talk hotkey: ${hotkeyLabel}`);
					return;
				}
			} catch (error) {
				console.error(`[VISION] Invalid hotkey ${accelerator}:`, error.message);
			}
			console.error(`[VISION] Hotkey ${accelerator} is taken by another app`);
		}
	}

	function markerBounds() {
		const { bounds } = screen.getPrimaryDisplay();
		const width = Math.round(MODE_BOUNDS.orb.width * MARKER_SCALE);
		const height = Math.round(MODE_BOUNDS.orb.height * MARKER_SCALE);
		return { x: bounds.x + bounds.width - width - 8, y: Math.round(bounds.y + (bounds.height - height) / 2), width, height };
	}

	// Only the visible disc or strip takes the mouse; the transparent rest passes clicks on.
	let passing = null;
	function passThrough(pass) {
		if (!win || pass === passing) return;
		passing = pass;
		win.setIgnoreMouseEvents(pass);
	}
	function pollPointer() {
		if (!win || marker || !win.isVisible()) return;
		const p = screen.getCursorScreenPoint();
		const b = win.getBounds();
		if (p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height) {
			win.webContents.send('vision-pointer', p.x - b.x, p.y - b.y);
		} else {
			passThrough(true);
		}
	}

	function layout() {
		if (!win) return;
		const wantMarker = fullScreenApp && (mode === 'orb' || mode === 'orb-hint');
		if (wantMarker !== marker) {
			marker = wantMarker;
			win.webContents.setZoomFactor(marker ? MARKER_SCALE : 1);
			win.setOpacity(marker ? 0.6 : 1);
			passThrough(true);
		}
		win.setBounds(marker ? markerBounds() : getBoundsForMode(mode), false);
	}

	function applyMode(next) {
		if (!win || !MODE_BOUNDS[next]) return;
		mode = next;
		layout();
	}

	function setVoiceState(state) {
		voiceState.connected = Boolean(state?.connected);
		voiceState.live = Boolean(state?.live);
		onVoiceState({ ...voiceState });
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
		...getBoundsForMode('orb'),
		frame: false,
		transparent: true,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		resizable: false,
		maximizable: false,
		fullscreenable: false,
		backgroundColor: '#00000000',
		// Clicking or dwelling on the orb must never take keyboard focus from the user's app.
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
	// Keep the orb above regular apps without stealing focus.
	win.setAlwaysOnTop(true, 'screen-saver');
	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	passThrough(true);
	// A text field (the keys sheet) needs the keyboard: focusable only while it is in use.
	win.on('blur', () => win?.setFocusable(false));
	win.webContents.once('did-finish-load', () => {
		if (win && !hidden) win.showInactive();
	});
	// Chromium remembers zoom per origin; the marker's zoom must not outlive the marker.
	win.webContents.on('did-finish-load', () => win?.webContents.setZoomFactor(marker ? MARKER_SCALE : 1));
	// A crashed or frozen renderer would leave a dead orb that only a hand could fix.
	win.webContents.on('render-process-gone', (_event, details) => {
		console.error('[VISION] Orb renderer gone:', details.reason, '- reloading');
		if (details.reason !== 'clean-exit') setTimeout(() => win?.webContents.reload(), 500);
	});
	win.on('unresponsive', () => {
		console.error('[VISION] Orb renderer unresponsive - reloading');
		win?.webContents.forcefullyCrashRenderer();
	});
	win.on('closed', () => {
		win = null;
		setVoiceState({ connected: false, live: false });
	});
	load();
	registerHotkey();

	const fromOrb = (event) => win && event.sender === win.webContents;
	ipcMain.on('vision-mode', (event, next) => fromOrb(event) && applyMode(next));
	ipcMain.on('vision-hit', (event, over) => fromOrb(event) && !marker && passThrough(!over));
	ipcMain.on('vision-keyboard', (event, wanted) => {
		if (!fromOrb(event)) return;
		win.setFocusable(Boolean(wanted));
		if (wanted) win.focus();
	});
	ipcMain.handle('vision-hotkey', () => hotkeyLabel);
	ipcMain.handle('vision-one-app', () => true);
	ipcMain.on('vision-hide', (event) => fromOrb(event) && win.hide());
	ipcMain.on('vision-quit', (event) => fromOrb(event) && app.quit());
	// { connected, live }: live = the mic is open (strip/console showing and not muted).
	ipcMain.on('vision-voice-state', (event, state) => fromOrb(event) && setVoiceState(state));
	ipcMain.handle('vision-connection-details', (event, options) => {
		if (!fromOrb(event)) throw new Error('not allowed');
		console.log('[VISION] Voice session token requested');
		return getConnectionDetails({ agentName: typeof options?.agentName === 'string' ? options.agentName : undefined });
	});
	// Heartbeat: Face Control treats a silent assistant as voice off.
	const heartbeat = setInterval(() => onVoiceState({ ...voiceState }), 4000);
	heartbeat.unref();
	const fullScreenPoll = setInterval(() => {
		const now = isFullScreenApp();
		if (now === fullScreenApp) return;
		fullScreenApp = now;
		console.log(`[VISION] Full-screen app ${now ? 'in front: orb shrinks to a marker' : 'gone'}`);
		layout();
	}, FULLSCREEN_POLL_MS);
	fullScreenPoll.unref();
	const pointerPoll = setInterval(pollPointer, POINTER_POLL_MS);
	pointerPoll.unref();

	return {
		activate,
		show: () => win?.showInactive(),
		hide: () => win?.hide(),
		getHotkeyLabel: () => hotkeyLabel,
		getWindow: () => win,
		destroy: () => {
			clearInterval(heartbeat);
			clearInterval(fullScreenPoll);
			clearInterval(pointerPoll);
			if (hotkey) globalShortcut.unregister(hotkey);
			win?.destroy();
		},
	};
}

module.exports = { createOrbWindow, registerConsoleScheme, resolveConsoleFile };
