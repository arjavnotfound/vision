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

function createOrbWindow({ preloadPath, iconPath, consoleDir, consoleUrl, getConnectionDetails, onVoiceState, wakeMode = false, hidden = false }) {
	let win = null;
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

	function applyMode(mode) {
		if (!win || !MODE_BOUNDS[mode]) return;
		win.setBounds(getBoundsForMode(mode), false);
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
		focusable: true,
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
	win.webContents.once('did-finish-load', () => {
		if (win && !hidden) win.showInactive();
	});
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
	ipcMain.on('vision-mode', (event, mode) => fromOrb(event) && applyMode(mode));
	ipcMain.handle('vision-hotkey', () => hotkeyLabel);
	ipcMain.handle('vision-one-app', () => true);
	ipcMain.handle('vision-wake-mode', () => wakeMode);
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

	return {
		activate,
		show: () => win?.showInactive(),
		hide: () => win?.hide(),
		getHotkeyLabel: () => hotkeyLabel,
		getWindow: () => win,
		destroy: () => {
			clearInterval(heartbeat);
			if (hotkey) globalShortcut.unregister(hotkey);
			win?.destroy();
		},
	};
}

module.exports = { createOrbWindow, registerConsoleScheme, resolveConsoleFile };
