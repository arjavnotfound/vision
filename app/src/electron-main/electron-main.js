// Privacy: VISION sends no telemetry or crash reports. The installed app checks GitHub
// Releases for updates (see startAutoUpdates); the Store build and dev runs never do.
const path = require('path');
const { app, globalShortcut, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs/promises');

// Used as the registry key name for run-at-login on Windows.
app.setAppUserModelId("io.github.arjavnotfound.vision");

const { getVersion } = require('./version.js');
// The upstream auto-updater (which queried another project's GitHub releases) was removed.

// --preview (design QA) runs in a throwaway profile: no real settings, no single-instance clash.
if (process.argv.includes('--preview')) {
	app.setPath('userData', path.join(app.getPath('temp'), 'vision-face-preview'));
} else if (process.env.VISION_USER_DATA_DIR) {
	// Tests / QA: isolated settings.
	app.setPath('userData', process.env.VISION_USER_DATA_DIR);
}

// Compare command line arguments:
// - unpackaged (in development):      "path/to/electron.exe" "." "maybe/a/file.png"
// - packaged (usually in production): "path/to/jspaint.exe" "maybe/a/file.png"
const { isPackaged } = app;
const argsArray = process.argv.slice(isPackaged ? 1 : 2);

const settingsFile = path.join(app.getPath('userData'), 'vision-settings.json');
// One-time move from the old app name, so calibration and settings carry over.
try {
	const oldSettings = path.join(app.getPath('appData'), 'VISION Face Control', 'vision-settings.json');
	const syncFs = require('fs');
	// Only the real profile: never into a QA/test (VISION_USER_DATA_DIR) or --preview profile.
	const realProfile = !process.env.VISION_USER_DATA_DIR && !process.argv.includes('--preview');
	if (realProfile && !syncFs.existsSync(settingsFile) && syncFs.existsSync(oldSettings)) {
		syncFs.mkdirSync(path.dirname(settingsFile), { recursive: true });
		syncFs.copyFileSync(oldSettings, settingsFile);
	}
} catch (error) {
	console.error("Could not copy settings from the old VISION Face Control folder:", error);
}
const formatName = "vision-settings";
const formatVersion = 1;
// No settings file yet: this is the first launch ever (Start screen, then calibration).
const firstRun = !require('fs').existsSync(settingsFile);

const { setLocale, getScreenOverlayMessageText } = require('./i18n.js');

// Load settings early for CLI localization
try {
	loadLanguageSettingSync();
} catch (error) {
	console.error("Error loading settings synchronously during startup:", error);
}

// File cli.js must be loaded after locale is loaded, with how it's set up right now.
const { parser } = require('./cli.js');

// Note: this may exit the app, if the user runs `vision --help`.
const args = parser.parse_args(argsArray);

// After argument parsing that may have exited the app, handle single instance behavior.
// Electron provides a way to communicate between instances of the app,
// using a lock file to determine if the process is the primary instance.
// However, it only provides communication in one direction
// (from the second instance to the primary instance, via the "second-instance" event),
// so we have to implement communication the other way ourselves.

// This is used to communicate the output of a CLI command from the existing instance to the new instance.
// Could use an in-memory pipe, or HTTP, but this may be the simplest way.
const tempFilePath = path.join(app.getPath('temp'), `vision-cli-output-${Date.now()}.txt`);

// Note: The "second-instance" event has an `argv` argument but it's unusably broken,
// and the documented workaround is to pass the arguments as `additionalData` here.
// https://www.electronjs.org/docs/api/app#event-second-instance
const gotSingleInstanceLock = app.requestSingleInstanceLock({
	// WARNING: key order and key length can cause this bug to crop up: https://github.com/electron/electron/issues/40615
	// For instance, naming this key "argv" instead of "arguments" can cause `additionalData` to be null when no arguments are passed.
	arguments: argsArray,
	tempFilePath,
});

// Note: If the main process crashes during the "second-instance" event, the second instance will get the lock,
// even if the first instance is still showing an error dialog.
if (!gotSingleInstanceLock) {
	// console.log("Already running. Opening in existing instance.");

	if (args.version) {
		// Special handling for --version: show versions of both instances.
		// TODO: might want to ditch the streaming below and read the whole file in order to COMPARE the versions,
		// and only show the version of the existing instance if it's different.
		// Or to format it differently. Right now it's constrained to outputting the existing instance as the last line.
		// Alternatively, I could pass the version into requestSingleInstanceLock (only if --version is passed, since it requires executing a git command),
		// and format the output in the existing instance's "second-instance" handler.
		// That would probably be cleaner, although it would be worse for error handling.
		console.log("CLI version:", getVersion());
		process.stdout.write("Running app's version: "); // avoid newline which would be added by console.log
	}

	// Proxy the output from the existing instance to the CLI command.
	(async () => {
		setTimeout(() => {
			if (args.version) {
				console.log("unknown");
			}
			console.error("Timed out waiting for file to exist:", tempFilePath);
			console.error("The already-running app is meant to write to this file with the output for the CLI command.");
			console.error("However, the app may have crashed or hung, or there may be a bug in the communication code.");
			app.exit(1);
		}, 10000);

		// Wait for file to exist.
		// (It may exist already, but we can't assume that.)
		const waitFor = (fn) => new Promise((resolve) => {
			const interval = setInterval(async () => {
				const result = await fn();
				if (result) {
					clearInterval(interval);
					resolve(result);
				}
			}, 100);
		});
		await waitFor(async () => fs.stat(tempFilePath).catch(() => null));
		// Stream the file to the new instance.
		// Note that this only avoids race conditions because the file is fully written before it's renamed and seen.
		// So using streaming here is not super meaningful.
		// (One could tail the file, but that would be more complex and I'm not sure you'd be able to tell when the file is closed without a sentinel value to mark the end of the stream.)
		const stream = require('fs').createReadStream(tempFilePath);
		stream.pipe(process.stdout);
		stream.on('close', () => {
			// Extra temp files will also be cleaned up on app startup, in case something goes wrong here.
			fs.unlink(tempFilePath).catch((error) => {
				console.error("Error deleting temp file:", error);
			}).finally(() => {
				app.quit();
			});
		});
		stream.on('error', (error) => {
			console.error("file stream error:", error);
			app.quit();
		});
	})();

	// app.quit();
	// `app.quit` does not immediately exit the process.
	// Return to avoid errors / main window briefly appearing.
	//   [52128:0304/194956.188:ERROR:cache_util_win.cc(20)] Unable to move the cache: Access is denied. (0x5)
	//   [52128:0304/194956.189:ERROR:cache_util.cc(145)] Unable to move cache folder C:\Users\Isaiah\AppData\Roaming\Electron\GPUCache to C:\Users\Isaiah\AppData\Roaming\Electron\old_GPUCache_000
	//   [52128:0304/194956.189:ERROR:disk_cache.cc(196)] Unable to create cache
	//   [52128:0304/194956.189:ERROR:shader_disk_cache.cc(613)] Shader Cache Creation failed: -2
	return;
} else {
	// console.log("Got single instance lock.");
	// When a second instance is opened, the "second-instance" event will be emitted in the this instance.
	// See handler below.
}

// Clean up temp files from previous runs.
// Only do this if the lock is acquired, so that multiple "second instances" can be handled in parallel, theoretically.
// (Otherwise one instance could delete the file before another instance reads it.)
// TODO: switch to a more inherently ephemeral communication method, like a pipe or a socket.
(async () => {
	try {
		for (const file of await fs.readdir(app.getPath('temp'))) {
			if (file.startsWith("vision-cli-output-")) {
				await fs.unlink(path.join(app.getPath('temp'), file));
			}
		}
	} catch (error) {
		console.error("Error during temp file cleanup:", error);
	}
})();

// Handle --version in the basic case where the app is not already running.
if (args.version) {
	console.log(getVersion());
	app.quit();
	return;
}

// Exit for arguments that are not supported when the app is not already running.
// Some or all of these could be supported in the future.
// `--profile` seems useful; `--adjust` not so much.
const secondInstanceOnlyArgs = ["profile", "adjust", "set", "get", "start", "stop"];
if (secondInstanceOnlyArgs.some(arg => args[arg])) {
	const badArgs = secondInstanceOnlyArgs.filter(arg => args[arg]);
	const badArgsString = badArgs.map(arg => `--${arg}`).join(", ");
	if (badArgs.length === 1) {
		console.log(`The argument ${badArgsString} is only supported when the app is already running.`);
	} else {
		console.log(`These arguments are only supported when the app is already running: ${badArgsString}.`);
	}
	console.log("If you have a use case, please open an issue at https://github.com/arjavnotfound/VISION-Research-Prototype/issues");
	app.quit();
	return;
}

// Normal app behavior continues here.

// One app: the voice assistant (orb window + agent sidecar) runs inside this process.
// VISION_NO_ASSISTANT=1 (synthetic QA) runs Face Control alone, as before.
const assistantEnabled = process.env.VISION_NO_ASSISTANT !== '1' && !args.preview;
const { agentLogFile } = require('./logs.js').installFileLogging(path.join(app.getPath('appData'), 'VISION', 'logs'));
const { createOrbWindow, registerConsoleScheme } = require('./orb-window.js');
const { createAudioDuck } = require('./audio-duck.js');
if (assistantEnabled) {
	// A fresh secret per run for the localhost bus (a pre-set one is kept for scripted checks).
	process.env.VISION_BUS_TOKEN ||= require('crypto').randomBytes(16).toString('hex');
	registerConsoleScheme();
}

const windowStateKeeper = require('electron-window-state');
const inputDriver = require('./input-driver.js');
const { setMouseLocation: setMouseLocationWithoutTracking, getMouseLocation, click, mouseDown, mouseUp, mouseUpSync, pressKey } = inputDriver;
console.log(`[VISION] Native input driver: ${inputDriver.describe()}`);
const { createMouseSafetyCoordinator } = require('./mouse-safety.js');
const { createScrollHandler, createOverlaySync, summarizeInputFeedback } = require('./input-gates.js');
const { ensureInitialRelativeMouseMove } = require('./win-relative-mouse.js');
const { allowGestureButton, allowGestureScroll, isMouthClickMode } = require('./gesture-policy.js');
const { createVisionBus } = require('./vision-bus.js');
const screen = require('electron').screen; // Note: can't be used until ready event

// Link to the voice assistant (see vision-bus.js). `live`: the assistant's mic is open.
const assistantState = { connected: false, live: false, at: 0 };
let internetOk = null;
const ASSISTANT_STALE_MS = 15000;

/** @type {BrowserWindow} */
let appWindow;
/** @type {BrowserWindow} */
let screenOverlayWindow;

let activeSettings = {};
let enabled = true;
let regainControlTimeout = null;

function isClickingAllowed() {
	if (regainControlTimeout || !enabled || activeSettings.clickingMode === 'off') {
		return false;
	}

	// Failsafe: don't click if the window(s) are closed or destroyed.
	if (
		(!screenOverlayWindow || screenOverlayWindow.isDestroyed()) ||
		(!appWindow || appWindow.isDestroyed())
	) {
		return false;
	}
	return true;
}

const mouseSafety = createMouseSafetyCoordinator({
	mouseDown,
	mouseUp,
	emergencyMouseUpSync: mouseUpSync,
	getClickingAllowed: isClickingAllowed,
});

mouseSafety.attachAppSafetyListeners(app);
mouseSafety.attachProcessSafetyListeners(process);

let screenScaleFactor = 1;
function updateScreenScaleFactor() {
	// Must wait for ready event before calling this
	screenScaleFactor = screen.getPrimaryDisplay().scaleFactor;
}

/**
 * Computes the bounding rectangle that spans all connected displays.
 * Must be called after the app 'ready' event.
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
// A window that covers a whole monitor counts as a full-screen app to Windows, which
// then holds back notifications. One pixel short of the bottom edge avoids that.
function overlayBounds(bounds) {
	return { ...bounds, height: bounds.height - 1 };
}

function computeVirtualDisplayBounds() {
	const displays = screen.getAllDisplays();
	const x = Math.min(...displays.map(d => d.bounds.x));
	const y = Math.min(...displays.map(d => d.bounds.y));
	const right = Math.max(...displays.map(d => d.bounds.x + d.bounds.width));
	const bottom = Math.max(...displays.map(d => d.bounds.y + d.bounds.height));
	return { x, y, width: right - x, height: bottom - y };
}

const { updateMenu, exportSettings, importSettings, setMenuUIMode } = require("./menus.js");
const { createAppWindow: createAppWindowWithOptions, createPreviewRunner, planLaunch } = require('./app-window.js');
const { createTray } = require('./tray.js');

setMenuUIMode({ getAppWindow: () => appWindow });
// eslint-disable-next-line no-unused-vars
let tray = null; // kept referenced so the tray icon is not garbage collected

function createAppWindow() {
	const plan = planLaunch({
		firstRun,
		assistant: assistantEnabled,
		oneAppEnv: process.env.VISION_ONE_APP,
		startEnabled: activeSettings.startEnabled,
	});
	console.log(`[VISION] Launch: ${firstRun ? 'first run' : 'later run'}${plan.hidden ? ', starting in the tray' : ''}`);
	return createAppWindowWithOptions({
		preloadPath: path.join(app.getAppPath(), 'src/preload-app-window.js'),
		windowStateKeeper,
		screen,
		syntheticFace: Boolean(args.synthetic_face),
		...plan,
	});
}

// The user asked for the window (tray, Start screen): show it and give it focus.
function raiseWindow(win) {
	if (!win || win.isDestroyed()) return;
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
}

// Background events (voice commands, the adaptive offer): show the window above the
// user's app without taking keyboard focus. Returns how it was before.
function showWindowInactive(win) {
	if (!win || win.isDestroyed()) return null;
	const before = !win.isVisible() ? 'hidden' : win.isMinimized() ? 'minimized' : 'shown';
	// Leaving topmost puts the window at the top of the normal windows, above the user's
	// app, without activating it (moveTop alone stays behind the foreground window).
	win.setAlwaysOnTop(true);
	win.showInactive();
	win.setAlwaysOnTop(false);
	return before;
}

// Window + app commands from the new UI (title bar buttons, settings sheet).
ipcMain.handle('windowControl', (event, action) => {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (!win) return false;
	if (action === 'minimize') {
		win.minimize();
	} else if (action === 'show') {
		raiseWindow(win);
	} else if (action === 'show-inactive') {
		return showWindowInactive(win);
	} else if (action === 'hide') {
		// Keeps tracking running; the tray icon brings the window back.
		win.hide();
	} else if (action === 'quit' || action === 'close') {
		// Clean quit: before-quit / will-quit release any held mouse button.
		app.quit();
	}
	return true;
});
ipcMain.handle('appCommand', async (event, command) => {
	if (command === 'export-settings') {
		await exportSettings();
	} else if (command === 'import-settings') {
		await importSettings();
	} else if (command === 'devtools') {
		BrowserWindow.fromWebContents(event.sender)?.webContents.toggleDevTools();
	}
	return true;
});
ipcMain.handle('getAppVersion', () => getVersion());
// QA hooks: only exist when the fake input driver is active.
if (process.env.VISION_FAKE_INPUT) {
	ipcMain.handle('qa', (_event, command) => {
		if (command?.type === 'physical-move') {
			inputDriver.simulatePhysicalMove(command.dx ?? 40, command.dy ?? 0);
			return true;
		}
		if (command?.type === 'safety-state') {
			return mouseSafety.getButtonStates();
		}
		return false;
	});
}
const { installCrashRecovery } = require('./crash-recovery.js');

// Allow recovering from WebGL crash unlimited times.
app.commandLine.appendSwitch("disable-gpu-process-crash-limit");
// Camera frames as GPU textures make every drawImage into the tracking canvas a GPU
// readback; on Electron 45 that cut the tracking loop from 67 to about 57 FPS.
app.commandLine.appendSwitch("disable-features", "MediaFoundationD3D11VideoCapture");
// Opt-in local debugging endpoint, used by scripts/bench/measure.js to read FPS.
// Never enabled unless the environment variable is set explicitly.
if (/^\d+$/.test(process.env.VISION_REMOTE_DEBUG_PORT || "")) {
	app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
	app.commandLine.appendSwitch("remote-debugging-port", process.env.VISION_REMOTE_DEBUG_PORT);
}
app.commandLine.appendSwitch("enable-blink-features", "MiddleClickAutoscroll");
async function loadSettings() {
	let data;
	try {
		data = await fs.readFile(settingsFile, 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') {
			return;
		}
		throw error;
	}
	const settings = JSON.parse(data);
	if (settings.formatName !== formatName) {
		throw new Error("Settings file format name doesn't match");
	}
	// Upgrade settings here
	// e.g.:
	// if (settings.formatVersion === 0) {
	// 	settings.formatVersion++;
	// 	settings.newSettingName = settings.someOldSettingName;
	// 	delete settings.someOldSettingName;
	// }
	if (settings.formatVersion < formatVersion) {
		throw new Error(`Unsupported settings file format version. There is no upgrade path from ${settings.formatVersion} to ${formatVersion}.`);
	}
	if (settings.formatVersion > formatVersion) {
		throw new Error(`Unsupported settings file format version (${settings.formatVersion}). This version of the app only supports up to format version ${formatVersion}.`);
	}
	deserializeSettings(settings);
}

// TODO: DRY with loadSettings
// Could use a { sync: true, languageOnly: true } options object
// or could split out the shared functionality into a helper function
// like handleFormatUpgrade(settings)
function loadLanguageSettingSync() {
	// Handle --cli-lang <lang> and --cli-lang=<lang>
	const cliLangArg = process.argv.find(arg => arg === "--cli-lang" || arg.startsWith("--cli-lang="));
	if (cliLangArg) {
		let lang;
		if (cliLangArg === "--cli-lang") {
			const langIndex = process.argv.indexOf("--cli-lang");
			if (langIndex !== -1 && process.argv[langIndex + 1]) {
				lang = process.argv[langIndex + 1];
			}
		} else if (cliLangArg.startsWith("--cli-lang=")) {
			lang = cliLangArg.split("=")[1];
		}
		if (lang) {
			setLocale(lang);
			return;
		}
	}

	// Handle settings file
	let data;
	try {
		data = require('fs').readFileSync(settingsFile, 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') {
			return;
		}
		throw error;
	}
	const settings = JSON.parse(data);
	if (settings.formatName !== formatName) {
		throw new Error("Settings file format name doesn't match");
	}
	// Upgrade settings here
	// e.g.:
	// if (settings.formatVersion === 0) {
	// 	settings.formatVersion++;
	// 	settings.newSettingName = settings.someOldSettingName;
	// 	delete settings.someOldSettingName;
	// }
	if (settings.formatVersion < formatVersion) {
		throw new Error(`Unsupported settings file format version. There is no upgrade path from ${settings.formatVersion} to ${formatVersion}.`);
	}
	if (settings.formatVersion > formatVersion) {
		throw new Error(`Unsupported settings file format version (${settings.formatVersion}). This version of the app only supports up to format version ${formatVersion}.`);
	}
	// deserializeSettings(settings);
	if (settings.globalSettings.language !== undefined) {
		setLocale(settings.globalSettings.language);
	}
}
async function saveSettings() {
	await fs.writeFile(settingsFile, JSON.stringify(serializeSettings(), null, '\t'));
}
function serializeSettings() {
	// TODO: DRY with serializeSettings in vision.js? The main stuff is taken care of now (listing every setting)
	// but it's still two places defining / dealing with the serialization format
	return {
		formatVersion,
		formatName,
		globalSettings: activeSettings,
		// profiles: [],
	};
};
function deserializeSettings(settings) {
	// TODO: DRY with deserializeSettings in vision.js? The main stuff is taken care of now (listing every setting)
	// but it's still two places defining / dealing with the serialization format

	// Handles partial settings objects,
	// to allow manually editing the settings file, removing settings to reset them to their defaults,
	// as well as accepting settings updates over IPC from the UI.
	// Don't use `... in settings.globalSettings` to check if a setting is defined.
	// We must ignore `undefined` values so that the defaults carry over from the renderer to the main process in the Electron app.
	// Similarly, `Object.assign` would overwrite existing settings with undefined values.
	if ("globalSettings" in settings) {
		for (const key in settings.globalSettings) {
			if (settings.globalSettings[key] !== undefined) {
				activeSettings[key] = settings.globalSettings[key];
			}
		}
		if (settings.globalSettings.runAtLogin !== undefined) {
			if (app.isPackaged) {
				// The NSIS install has a fixed path, so the default (this executable) is right.
				app.setLoginItemSettings({
					openAtLogin: activeSettings.runAtLogin,
				});
			} else {
				// console.log("Ignoring runAtLogin setting because the app is not packaged.");
				// Could maybe try to pass it arguments to run the app in development mode, but it might not be worth it.
			}
		}
		if (settings.globalSettings.language !== undefined) {
			setLocale(settings.globalSettings.language);
			updateMenu();
		}
	}
}

// setMouseLocation/getMouseLocation are asynchronous,
// which means we have to be smart about detecting manual mouse movement.
// We don't want to pause the mouse control due to head tracker based movement.
// So instead of detecting a distance from the last mouse position,
// we'll check against a history of positions.
// How long should the queue be? Points could be removed when setMouseLocation resolves,
// if and only if it's guaranteed that getMouseLocation will return the new position at that point.
// However, a simple time limit should be fine.
const mousePosHistoryDuration = 5000; // in milliseconds; affects time to switch back to camera control after manual mouse movement (although maybe it shouldn't)
const mousePosHistory = [];
async function setMouseLocationVision(x, y) {
	// On Windows, ensure the cursor is visible when using "Run at login".
	// The cursor starts invisible at login and remains invisible when sending absolute mouse moves.
	// ShowCursor() also does not work to show the cursor, but a relative mouse move does.
	ensureInitialRelativeMouseMove();

	const time = performance.now();
	mousePosHistory.push({ point: { x, y }, time });
	// Test robustness using this artificial delay:
	// await new Promise((resolve) => setTimeout(resolve, Math.random() * 100));
	await setMouseLocationWithoutTracking(x * screenScaleFactor, y * screenScaleFactor);
}
function pruneMousePosHistory() {
	const now = performance.now();
	while (mousePosHistory[0] && now - mousePosHistory[0].time > mousePosHistoryDuration) {
		mousePosHistory.shift();
	}
}


const createWindow = () => {
	appWindow = createAppWindow();
	const appWindowState = appWindow._visionWindowState;

	// Toggle the DevTools with F12
	appWindow.webContents.on("before-input-event", (_e, input) => {
		if (input.type === "keyDown" && input.key === "F12") {
			appWindow.webContents.toggleDevTools();

			appWindow.webContents.on('devtools-opened', async () => {
				// Can't use appWindow.webContents.devToolsWebContents.on("before-input-event") - it just doesn't intercept any events.
				await appWindow.webContents.devToolsWebContents.executeJavaScript(`
					new Promise((resolve)=> {
						addEventListener("keydown", (event) => {
							if (event.key === "F12") {
								resolve();
							}
						}, { once: true });
					})
				`);
				appWindow.webContents.toggleDevTools();
			});
		}
	});

	// Restore window state, and listen for window state changes.
	appWindowState.manage(appWindow);

	mouseSafety.attachWindowSafetyListeners(appWindow, 'appWindow');

	// Clean up overlay and mouse safety when the app window is closed.
	appWindow.on('closed', () => {
		appWindow = null;
		mouseSafety.releaseAllMouseButtons('app-window-closed');
		clearTimeout(monitorMousePositionTid);
		overlaySync.dispose();
		clearTimeout(regainControlTimeout);
		if (screenOverlayWindow && !screenOverlayWindow.isDestroyed()) {
			try {
				screenOverlayWindow.destroy();
			} catch (_err) {
				// Non-critical overlay destroy error on shutdown
			}
		}
		app.quit();
	});

	// Helper for safely sending messages without spamming the console
	function trySendOverlayWindowMessage(message, ...args) {
		// Could include logic to log when toggling between able and unable to update,
		// but for now it's enough to avoid errors spamming the console.
		if (!screenOverlayWindow || screenOverlayWindow.isDestroyed()) {
			// This can happen while closing the app normally.
			return false;
		}
		if (screenOverlayWindow.webContents.isDestroyed()) {
			return false;
		}
		if (screenOverlayWindow.webContents.isCrashed()) {
			return false;
		}
		if (screenOverlayWindow.webContents.isLoadingMainFrame()) {
			// This happens normally during startup.
			return false;
		}
		screenOverlayWindow.webContents.send(message, ...args);
		return true;
	}

	// Expose functionality to the renderer processes.

	// Allow controlling the mouse, but pause if the mouse is moved normally.
	const thresholdToRegainControl = 10; // in pixels
	const regainControlForTime = 2000; // in milliseconds, AFTER the mouse hasn't moved for more than mouseMoveRequestHistoryDuration milliseconds (I think)
	let inputFeedback = {};
	let primaryDisplay = screen.getPrimaryDisplay();
	let virtualDisplayBounds = computeVirtualDisplayBounds();
	let systemMousePosition = null;
	const buildOverlayPayload = () => {
		const workAreaContainerBounds = {
			x: primaryDisplay.workArea.x - virtualDisplayBounds.x,
			y: primaryDisplay.workArea.y - virtualDisplayBounds.y,
			width: primaryDisplay.workArea.width,
			height: primaryDisplay.workArea.height,
		};
		const isManualTakeback = enabled && regainControlTimeout !== null;

		return {
			isEnabled: enabled && !isManualTakeback,
			isManualTakeback,
			clickingMode: activeSettings.clickingMode,
			closeEyesToToggle: Boolean(activeSettings.closeEyesToToggle),
			dwellDrag: Boolean(activeSettings.dwellDrag),
			dwellTime: activeSettings.dwellTime,
			inputFeedback: summarizeInputFeedback(inputFeedback),
			heldButtons: mouseSafety.getButtonStates(),
			workAreaContainerBounds,
			messageText: getScreenOverlayMessageText({ isManualTakeback, enabled }),
			systemMousePosition,
			soundEffectsEnabled: activeSettings.soundEffects,
		};
	};
	// Coalesced: at most ~60 Hz, and only when something changed.
	const overlaySync = createOverlaySync({
		send: (payload) => {
			if (!trySendOverlayWindowMessage('overlayUpdate', payload)) {
				return false;
			}
			return true;
		},
		minIntervalMs: 16,
	});
	const updateDwellClickingAndHUD = () => {
		overlaySync.request(buildOverlayPayload);
	};

	let monitorMousePositionTid = null;
	async function monitorMousePosition() {
		// Failsafe watchdog: never let a button stay held while clicking is disallowed.
		mouseSafety.enforceClickingGate('watchdog');
		try {
			const pos = await getMouseLocation();
			// Convert to overlay-local CSS coordinates (subtract the overlay window's virtual origin).
			const x = Math.round(pos.x / screenScaleFactor - virtualDisplayBounds.x);
			const y = Math.round(pos.y / screenScaleFactor - virtualDisplayBounds.y);
			if (!systemMousePosition || systemMousePosition.x !== x || systemMousePosition.y !== y) {
				systemMousePosition = { x, y };
			}
		} catch (error) {
			console.error("Error getting mouse position:", error);
		}
		try {
			// Update hide-HUD-near-cursor effect
			updateDwellClickingAndHUD();
		} catch (error) {
			console.error("Error updating overlay (with new mouse position):", error);
		}
		clearTimeout(monitorMousePositionTid);
		monitorMousePositionTid = setTimeout(monitorMousePosition, 16);
	}
	monitorMousePosition();

	ipcMain.on('moveMouse', async (_event, x, y, time) => {
		const curPos = await getMouseLocation();
		curPos.x /= screenScaleFactor;
		curPos.y /= screenScaleFactor;

		pruneMousePosHistory();
		const distances = mousePosHistory.map(({ point }) => Math.hypot(curPos.x - point.x, curPos.y - point.y));
		const distanceMoved = distances.length ? Math.min(...distances) : 0;

		if (distanceMoved > thresholdToRegainControl) {
			clearTimeout(regainControlTimeout);
			regainControlTimeout = setTimeout(() => {
				regainControlTimeout = null; // used to check if we're pausing
				updateDwellClickingAndHUD();
			}, regainControlForTime);
			// Fail-safe: release any held mouse buttons when manual physical takeover occurs!
			mouseSafety.releaseAllMouseButtons('manual-takeover');
			updateDwellClickingAndHUD();

			mousePosHistory.push({ point: { x: curPos.x, y: curPos.y }, time: performance.now(), from: "moveMouse" });
		} else if (regainControlTimeout === null && enabled) {
			setMouseLocationVision(x, y);
		}

		trySendOverlayWindowMessage('moveMouse', x - virtualDisplayBounds.x, y - virtualDisplayBounds.y, time);
	});

	ipcMain.on('notifyToggleState', async (_event, nowEnabled) => {
		let initialPos;
		if (nowEnabled) { // don't rely on getMouseLocation when disabling the software
			initialPos = await getMouseLocation();
			initialPos.x /= screenScaleFactor;
			initialPos.y /= screenScaleFactor;
		}
		enabled = nowEnabled;

		if (!nowEnabled) {
			// Fail-safe: release any held simulated buttons when tracking disabled!
			mouseSafety.releaseAllMouseButtons('tracking-disabled');
		}

		// Start immediately if enabled.
		clearTimeout(regainControlTimeout);
		regainControlTimeout = null;
		mousePosHistory.length = 0;
		if (nowEnabled) {
			// Avoid false positive for manual takeback.
			mousePosHistory.push({ point: { x: initialPos.x, y: initialPos.y }, time: performance.now(), from: "notifyToggleState" });
		}

		updateDwellClickingAndHUD();
	});
	ipcMain.on('updateInputFeedback', (_event, data) => {
		inputFeedback = data;
		updateDwellClickingAndHUD();
	});


	ipcMain.on('setOptions', (_event, newOptions) => {
		deserializeSettings(newOptions);
		saveSettings();
		if (activeSettings.clickingMode === 'off') {
			mouseSafety.releaseAllMouseButtons('clicking-mode-off');
		}
	});

	ipcMain.handle('getOptions', async () => {
		return serializeSettings();
	});

	ipcMain.handle('getIsPackaged', async () => {
		return app.isPackaged;
	});


	ipcMain.on('click', async (_event, x, y, _time) => {
		if (!isClickingAllowed()) {
			return;
		}

		// Translate coords in case of debug (doesn't matter when it's fullscreen).
		x += screenOverlayWindow.getContentBounds().x;
		y += screenOverlayWindow.getContentBounds().y;

		await setMouseLocationVision(x, y);
		await click(activeSettings.swapMouseButtons ? "right" : "left");
		trySendOverlayWindowMessage('overlayPulse', 'L');
	});

	// Desktop dwell drag (off by default; setting "dwellDrag"): the overlay's first dwell
	// presses the primary button, the next dwell releases it. Goes through mouseSafety, so
	// presses obey the clicking gate and releases are always allowed.
	ipcMain.handle('dwellMouseButton', async (_event, down, x, y) => {
		if (down) {
			if (!activeSettings.dwellDrag || !isClickingAllowed()) {
				return false;
			}
			const bounds = screenOverlayWindow.getContentBounds();
			await setMouseLocationVision(x + bounds.x, y + bounds.y);
		}
		const changed = await mouseSafety.setMouseButtonState(0, Boolean(down), Boolean(activeSettings.swapMouseButtons));
		if (changed) {
			trySendOverlayWindowMessage('overlayPulse', down ? 'DRAG' : 'DROP');
		}
		updateDwellClickingAndHUD();
		return changed;
	});

	ipcMain.handle('setMouseButtonState', async (_event, button, down) => {
		const policy = allowGestureButton({
			button,
			down,
			clickingMode: activeSettings.clickingMode,
			voiceLive: assistantState.live,
			controlMap: activeSettings.controlMap,
		});
		if (!policy.allowed) {
			return false;
		}
		const changed = await mouseSafety.setMouseButtonState(button, down, Boolean(activeSettings.swapMouseButtons));
		if (changed) {
			if (down) {
				// Gesture click: shutter-snap on the overlay with the button the face asked for.
				trySendOverlayWindowMessage('overlayPulse', button === 2 ? 'R' : button === 1 ? 'M' : 'L');
			}
			updateDwellClickingAndHUD();
		}
		return changed;
	});

	// Set up the screen overlay window. Sized to the displays, never `fullscreen`: Windows
	// treats a full-screen window as a full-screen app and holds back notifications.
	screenOverlayWindow = new BrowserWindow({
		x: virtualDisplayBounds.x,
		y: virtualDisplayBounds.y,
		width: virtualDisplayBounds.width,
		height: virtualDisplayBounds.height,
		frame: false,
		transparent: true,
		backgroundColor: '#00000000',
		hasShadow: false,
		roundedCorners: false,
		alwaysOnTop: true,
		resizable: false,
		movable: false,
		minimizable: false,
		maximizable: false,
		closable: false,
		focusable: false,
		skipTaskbar: true,
		hiddenInMissionControl: true,
		accessibleTitle: 'VISION Screen Overlay',
		webPreferences: {
			preload: path.join(app.getAppPath(), 'src/preload-screen-overlay.js'),
		},
	});
	// Windows fits a new window into the work area; set the bounds again to cover the taskbar.
	screenOverlayWindow.setBounds(overlayBounds(virtualDisplayBounds));
	screenOverlayWindow.setIgnoreMouseEvents(true);
	screenOverlayWindow.setAlwaysOnTop(true, 'screen-saver');

	mouseSafety.attachWindowSafetyListeners(screenOverlayWindow, 'screenOverlayWindow');

	// Halo, dwell ring, click pulse.
	screenOverlayWindow.loadFile('src/overlay/overlay.html');
	// After a (re)load the overlay has no state; make sure the next update is sent in full.
	screenOverlayWindow.webContents.on('did-finish-load', () => {
		overlaySync.invalidate();
		updateDwellClickingAndHUD();
	});
	screenOverlayWindow.on('close', (event) => {
		// If Windows Explorer is restarted while the app is running,
		// the Screen Overlay Window can appear in the taskbar, and become closable.
		// Various window attributes are forgotten, so we need to reset them.
		// A more proactive approach of restoring skipTaskbar when Windows Explorer is restarted would be better.
		// See: https://github.com/1j01/vision-hft/issues/47
		// And: https://github.com/electron/electron/issues/29526
		event.preventDefault();
		screenOverlayWindow.setSkipTaskbar(true);
		screenOverlayWindow.setClosable(false);
		screenOverlayWindow.setBounds(overlayBounds(virtualDisplayBounds));
		screenOverlayWindow.setIgnoreMouseEvents(true);
		// "screen-saver" is the highest level; it should show above the taskbar.
		screenOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
		// The window isn't showing on top of the taskbar without this.
		screenOverlayWindow.hide();
		screenOverlayWindow.show();
	});
	screenOverlayWindow.on('closed', () => {
		screenOverlayWindow = null;
	});

	function updateDisplayConfiguration() {
		primaryDisplay = screen.getPrimaryDisplay();
		virtualDisplayBounds = computeVirtualDisplayBounds();
		screenOverlayWindow?.setBounds(overlayBounds(virtualDisplayBounds));
		updateDwellClickingAndHUD();
		appWindow?.webContents.send('virtualDisplayBoundsChanged', virtualDisplayBounds);
	}

	screen.on('display-metrics-changed', updateDisplayConfiguration);
	screen.on('display-added', updateDisplayConfiguration);
	screen.on('display-removed', updateDisplayConfiguration);

	// screenOverlayWindow.webContents.openDevTools({ mode: 'detach' });
};

ipcMain.handle('getVirtualDisplayBounds', () => computeVirtualDisplayBounds());

installCrashRecovery({
	getAppWindow: () => appWindow,
	getScreenOverlayWindow: () => screenOverlayWindow,
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
	try {
		await loadSettings();
	} catch (error) {
		// TODO: copy file to a backup location, and continue with default settings
		// No blocking dialog (nobody should need a hand to get past it): keep the broken
		// file for inspection and start with default settings.
		console.error("Failed to load settings; starting with defaults:", error);
		try {
			await fs.rename(settingsFile, `${settingsFile}.broken-${Date.now()}`);
		} catch (renameError) {
			console.error("Could not move the broken settings file aside:", renameError);
		}
		activeSettings = {};
	}
	if (firstRun && app.isPackaged && !args.preview) {
		// A new install is often set up for someone who cannot press F9 or start the app:
		// track from launch and start with Windows. Saved choices are never touched.
		deserializeSettings({ globalSettings: { startEnabled: true, runAtLogin: true } });
		await saveSettings().catch((error) => console.error("Could not save first-run settings:", error));
	}
	if (args.preview) {
		// --preview: mocked engine, no camera, no overlay, no mouse control. For design QA.
		updateMenu();
		createPreviewRunner({ args, preloadPath: path.join(app.getAppPath(), 'src/preload-app-window.js') }).start();
		return;
	}
	createWindow();
	// Face control first: it never waits for the network, the keys or the agent.
	startAssistant(startVisionBus());
	// Ensure the menus exist when language is not set (i.e. first run)
	// This is computationally redundant when language is already set (handled in deserializeSettings)
	updateMenu();
	tray = createTray({
		getWindow: () => appWindow,
		toggleTracking: () => appWindow?.webContents.send("shortcut", "toggle-tracking"),
		sendCommand: (command) => {
			appWindow?.show();
			appWindow?.webContents.send('uiCommand', command);
		},
		talk: orb && { label: orb.getHotkeyLabel(), activate: orb.activate },
	});

	updateScreenScaleFactor();
	screen.on('display-metrics-changed', (/*event, display, changedMetrics*/) => {
		updateScreenScaleFactor();
	});
	screen.on('display-added', updateScreenScaleFactor);
	screen.on('display-removed', updateScreenScaleFactor);

	startAutoUpdates();

	const success = globalShortcut.register('F9', () => {
		// console.log('Toggle tracking');
		appWindow?.webContents.send("shortcut", "toggle-tracking");
	});
	if (!success) {
		// Not a blocking dialog: nobody should need a hand to dismiss it. Pause stays
		// available from the window, the tray, closing the eyes, and the voice.
		console.error("[VISION] Could not register the F9 shortcut (another app owns it).");
	}
});

app.on("second-instance", (_event, uselessCorruptedArgv, workingDirectory, additionalData) => {
	// Someone tried to run a second instance, or is trying to use the vision CLI.
	// If there are no arguments, we should focus the app's main window.
	// If there are arguments, we should handle adjusting settings for the running app.

	// Note: the "second-instance" event sends a broken argv which may rearrange and add extra arguments,
	// so we have to use the `additionalData` object, passed from `requestSingleInstanceLock`.
	// This hack is recommended in the docs: https://www.electronjs.org/docs/api/app#event-second-instance
	console.log("second-instance", { uselessCorruptedArgv, workingDirectory, additionalData });

	// Unfortunately, it turns out `additionalData` is buggy too, and becomes null under some obscure conditions.
	// See https://github.com/electron/electron/issues/40615
	if (!additionalData) {
		// I would move this into `handleSecondInstance` and use `logToCLI`, but it won't work because `additionalData` is null.
		console.log(`second-instance: additionalData === ${additionalData}. See https://github.com/electron/electron/issues/40615`);
		return;
	}

	function deliverOutputToCLI(output) {
		console.log("second-instance: Outputting to CLI:", output);

		// Rename the file after fully writing it to avoid race conditions.
		const tempTempFilePath = additionalData.tempFilePath + ".tmp";
		fs.writeFile(tempTempFilePath, output)
			.then(() => {
				console.log("second-instance: Wrote output to", tempTempFilePath);
				fs.rename(tempTempFilePath, additionalData.tempFilePath)
					.then(() => {
						console.log("second-instance: Renamed output file to", additionalData.tempFilePath);
					}, (error) => {
						console.error(`second-instance: Failed to rename output file to ${additionalData.tempFilePath}:`, error);
					});
			}, (error) => {
				console.error(`second-instance: Failed to write output to ${tempTempFilePath}:`, error);
			});
	}

	// `deliverOutputToCLI` has to be called exactly once.
	// If it's not called, the CLI command will show a timeout error message.
	// If it's called multiple times, only one output will be shown, or there might be an error renaming the file.
	// In order to allow many return paths in this logic, without requiring a function call before each return,
	// use an inner function (`handleSecondInstance`), and call `deliverOutputToCLI` at the end of the outer function.
	let output = "";
	function logToCLI(message) {
		output += message + "\n";
	}
	function handleSecondInstance() {
		const argv = additionalData.arguments;
		if (argv.length === 0) {
			// TODO: DRY with `activate` event handler?
			if (BrowserWindow.getAllWindows().length === 0) {
				logToCLI("The app is likely already launching.");
			} else if (appWindow) {
				logToCLI("Focusing the existing app window.");
				if (appWindow.isMinimized()) {
					appWindow.restore();
				}
				appWindow.show();
			}
			return;
		}

		const args = parser.parse_args(argv);
		console.log("second-instance: parsed args:", args);
		if (args.start || args.stop) {
			if (!!args.start === !!args.stop) {
				logToCLI("Exactly one of --start or --stop must be provided.");
				return;
			}
			if (!appWindow) {
				// TODO: create window if it doesn't exist (like `activate`) and make sure to start enabled
				// (but don't need to open the app for --stop)
				// (and don't focus the window if it's already open)
				logToCLI("The app window is not open.");
				return;
			}
			if (enabled !== !!args.start) {
				appWindow.webContents.send("shortcut", "toggle-tracking");
				logToCLI(`Toggled head tracking to ${enabled ? "off" : "on"}.`);
				return;
			}
			logToCLI(`Head tracking is already ${enabled ? "on" : "off"}.`);
			return;
		}
		if (args.set || args.adjust || args.get || args.profile) {
			logToCLI("Arguments not supported yet. CLI is a work in progress.");
			return;
		}
		if (args.version) {
			// This is special-cased to show both the CLI and running app versions.
			// The output from here is combined on the CLI's side.
			logToCLI(getVersion());
			return;
		}
		logToCLI("No arguments recognized.");
	}

	handleSecondInstance();
	deliverOutputToCLI(output);
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
// NOTE: currently exiting with app.exit()
// If re-assessing this, for macOS, make sure to handle the global shortcut, when the window doesn't exist.
app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on('activate', () => {
	// On OS X it's common to re-create a window in the app when the
	// dock icon is clicked and there are no other windows open.
	// That said, we don't want to doubly create the window if the app is already launching,
	// and BrowserWindow.getAllWindows().length === 0 is not a sufficient check for that.
	// Currently (and I don't see a reason to change this) we don't leave the app running on macOS without a window,
	// so we don't need to handle recreating the windows.
	// if (BrowserWindow.getAllWindows().length === 0) {
	// 	createWindow();
	// }
});

// Windows Settings > Camera: brightness, contrast and other properties for each camera.
// It is an ordinary window, so it works with the head cursor. The device name is unused.
ipcMain.handle('openCameraSettings', async () => {
	try {
		await shell.openExternal('ms-settings:camera');
		return {};
	} catch (error) {
		return { error: `Could not open camera settings: ${error.message}` };
	}
});

ipcMain.handle('openOnScreenKeyboard', async () => {
	console.log("Requested to open built-in On-Screen Keyboard");
	if (process.platform === 'win32') {
		const { spawn, exec } = require('child_process');
		try {
			// On Windows, launching osk.exe via PowerShell Start-Process avoids 32/64-bit redirection issues
			// and ensures the On-Screen Keyboard process launches detached and interactive.
			const proc = spawn('powershell.exe', [
				'-NoProfile',
				'-WindowStyle', 'Hidden',
				'-ExecutionPolicy', 'Bypass',
				'-Command', 'Start-Process osk.exe'
			], { detached: true, stdio: 'ignore' });
			proc.unref();
			return { success: true };
		} catch (err) {
			console.error("Failed to spawn On-Screen Keyboard via PowerShell:", err);
			try {
				const fallbackProc = spawn('cmd.exe', ['/c', 'start', 'osk.exe'], { detached: true, stdio: 'ignore' });
				fallbackProc.unref();
				return { success: true };
			} catch (fallbackErr) {
				console.error("Failed to spawn On-Screen Keyboard via cmd, trying exec:", fallbackErr);
				try {
					exec('start osk.exe', { windowsHide: true });
					return { success: true };
				} catch (finalErr) {
					console.error("All OSK launch methods failed:", finalErr);
					return { error: finalErr.message };
				}
			}
		}
	} else if (process.platform === 'darwin') {
		// macOS Accessibility Keyboard trigger
		const { spawn } = require('child_process');
		try {
			spawn('osascript', ['-e', 'tell application "System Events" to key code 53'], { detached: true, stdio: 'ignore' });
			return { success: true };
		} catch (err) {
			return { error: err.message };
		}
	} else {
		// Linux virtual keyboard
		const { spawn } = require('child_process');
		try {
			spawn('onboard', [], { detached: true, stdio: 'ignore' });
			return { success: true };
		} catch (err) {
			return { error: err.message };
		}
	}
});

// Mouth-open + head-tilt scrolling. Uses the module-level isClickingAllowed gate
// (this used to throw a ReferenceError because the gate was scoped inside 'ready').
const handleScroll = createScrollHandler({ isClickingAllowed, pressKey });
ipcMain.handle('scrollMouse', (_event, deltaY) => {
	if (!allowGestureScroll({ voiceLive: assistantState.live, controlMap: activeSettings.controlMap }).allowed) {
		return false;
	}
	return handleScroll(deltaY);
});

ipcMain.handle('releaseButtons', (_event, reason) => {
	mouseSafety.releaseAllMouseButtons(String(reason || 'ui'));
	return true;
});

// Adaptive control map: a gesture the UI re-routed to a click (e.g. raised brows -> right
// click) clicks at the current cursor position, behind the same clicking gate.
let lastMappedClick = 0;
ipcMain.handle('mappedClick', async (_event, button) => {
	if (!isClickingAllowed() || !['left', 'right'].includes(button)) {
		return false;
	}
	const now = Date.now();
	if (now - lastMappedClick < 700) {
		return false;
	}
	lastMappedClick = now;
	await click(button);
	try {
		screenOverlayWindow?.webContents.send('overlayPulse', button === 'right' ? 'R' : 'L');
	} catch (_error) {
		// overlay closing
	}
	return true;
});

// ---- VISION bus (only when started by the VISION launcher, which sets the token)
// Launcher preflight (camera, mic, internet, voice keys, web build), shown on the Start screen.
let preflight = null;
try {
	preflight = process.env.VISION_PREFLIGHT ? JSON.parse(process.env.VISION_PREFLIGHT) : null;
} catch (_error) {
	preflight = null;
}

function sendBusState() {
	appWindow?.webContents.send('busState', {
		preflight,
		assistant: { connected: assistantState.connected, live: assistantState.live, seen: assistantState.at > 0 },
		internet: internetOk,
		busEnabled: Boolean(process.env.VISION_BUS_TOKEN),
	});
}
ipcMain.handle('getBusState', () => {
	sendBusState();
	return true;
});

function setAssistantState({ connected, live }) {
	const wasLive = assistantState.live;
	if (!assistantState.at) {
		console.log('[VISION] Voice assistant linked');
	}
	assistantState.connected = connected;
	assistantState.live = live;
	assistantState.at = Date.now();
	if (live && !wasLive && isMouthClickMode(activeSettings.clickingMode)) {
		// Talking starts: let go of anything the mouth was holding.
		mouseSafety.releaseAllMouseButtons('voice-on');
	}
	if (live !== wasLive) {
		console.log(`[VISION] Voice ${live ? 'on: mouth gestures paused' : 'off'}`);
	}
	// Other apps go quieter while VISION listens and speaks.
	audioDuck?.set(Boolean(live));
	sendBusState();
}

function showAppWindow() {
	showWindowInactive(appWindow);
}

const BUS_UI_COMMANDS = new Set(['pause', 'resume', 'toggle-pause', 'recalibrate', 'speed', 'click-mode', 'remap', 'show', 'controls']);
async function handleBusCommand(cmd, value) {
	if (cmd === 'quit') {
		mouseSafety.releaseAllMouseButtons('voice-quit');
		setTimeout(() => app.quit(), 400);
		return { done: 'quit' };
	}
	if (cmd === 'status') {
		return { state: busStatus() };
	}
	if (cmd === 'voice-settings') {
		// "Change your voice", "speak Hindi": takes effect from the next voice session.
		if (!voiceSettings) throw new Error('voice settings are not available');
		return { done: 'voice-settings', settings: applyVoiceSettings(value ?? {}) };
	}
	if (cmd === 'selftest-gesture') {
		// CHECK.bat: a left-wink click through the gesture policy, the clicking gate and the
		// button watchdog into the input driver. Only with the fake driver (never a real click).
		if (!process.env.VISION_FAKE_INPUT) {
			throw new Error('self-test needs the fake input driver');
		}
		const policy = allowGestureButton({ button: 0, down: true, clickingMode: 'blink', voiceLive: assistantState.live, controlMap: activeSettings.controlMap });
		if (!policy.allowed) {
			return { done: 'blocked', reason: policy.reason };
		}
		const pressed = await mouseSafety.setMouseButtonState(0, true, false);
		await new Promise((resolve) => setTimeout(resolve, 80));
		const released = await mouseSafety.setMouseButtonState(0, false, false);
		return { done: 'gesture', pressed, released, held: mouseSafety.getButtonStates() };
	}
	if (!BUS_UI_COMMANDS.has(cmd)) {
		throw new Error(`unknown command: ${cmd}`);
	}
	if (!appWindow) {
		throw new Error('VISION window is not open');
	}
	if (['recalibrate', 'show', 'controls', 'remap'].includes(cmd)) {
		showAppWindow();
	}
	// The UI answers with what it did, so the assistant never claims a change that did not happen.
	const reply = await new Promise((resolve) => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const timer = setTimeout(() => {
			ipcMain.removeAllListeners(`busReply:${id}`);
			resolve({ done: cmd, note: 'no reply from the window' });
		}, 2500);
		ipcMain.once(`busReply:${id}`, (_event, result) => {
			clearTimeout(timer);
			resolve(result ?? { done: cmd });
		});
		appWindow.webContents.send('uiCommand', { type: 'bus', id, cmd, value });
	});
	return reply;
}

function busStatus() {
	return {
		tracking: enabled,
		clickingMode: activeSettings.clickingMode,
		voiceLive: assistantState.live,
		controlMap: activeSettings.controlMap ?? null,
	};
}

async function checkInternet() {
	if (process.env.VISION_SIMULATE_OFFLINE === '1') {
		internetOk = false;
		sendBusState();
		return;
	}
	try {
		await require('dns').promises.resolve('livekit.io');
		internetOk = true;
	} catch (_error) {
		internetOk = false;
	}
	sendBusState();
}

/** Resolves with the bus port once it listens (null when the bus is off or failed). */
function startVisionBus() {
	const token = process.env.VISION_BUS_TOKEN;
	if (!token) return Promise.resolve(null);
	const bus = createVisionBus({
		// Any free port unless one is pre-set; the agent is told which one.
		port: Number(process.env.VISION_BUS_PORT || 0),
		token,
		onAssistant: setAssistantState,
		onCommand: handleBusCommand,
		getState: busStatus,
	});
	const ready = bus.start().then((port) => {
		process.env.VISION_BUS_PORT = String(port);
		return port;
	}, (error) => {
		console.error('[VISION] Bus failed to start:', error);
		return null;
	});
	// The overlay sends a heartbeat every few seconds; if it stops, voice is off.
	setInterval(() => {
		if (assistantState.at && Date.now() - assistantState.at > ASSISTANT_STALE_MS && (assistantState.connected || assistantState.live)) {
			setAssistantState({ connected: false, live: false });
			assistantState.at = 1;
		}
	}, 3000).unref();
	checkInternet();
	setInterval(checkInternet, 10000).unref();
	return ready;
}

// ---- Voice assistant: the orb window and the agent sidecar.
let orb = null;
let agentSupervisor = null;

function startAssistant(busReady) {
	if (!assistantEnabled) return;
	const { readDevKeys, hasVoiceKeys } = require('./voice-keys.js');
	const { createConnectionDetails } = require('./livekit-token.js');
	const { createAgentSupervisor, resolveAgentCommand } = require('./agent-supervisor.js');
	const { createVoiceSettings, VOICES, VOICE_KEY_FIELDS } = require('./voice-settings.js');
	const appPath = app.getAppPath();
	voiceSettings = createVoiceSettings({ dir: app.getPath('userData'), safeStorage: require('electron').safeStorage });
	// Keys typed into Settings (encrypted); dev builds also read agent/.env.local, which wins.
	const voiceKeys = { ...voiceSettings.readKeys(), ...(app.isPackaged ? {} : readDevKeys(path.join(appPath, '..', 'agent'))) };
	const keysOk = hasVoiceKeys(voiceKeys);
	preflight = { ...(preflight ?? {}), keys: keysOk, build: 'ok' };
	sendBusState();

	const fromOrb = (event) => orb?.getWindow()?.webContents === event.sender;
	const voiceConfig = () => ({ ...voiceSettings.read(), hasKeys: hasVoiceKeys(voiceKeys), voices: VOICES, keyFields: VOICE_KEY_FIELDS });
	ipcMain.handle('vision-voice-config', (event) => (fromOrb(event) ? voiceConfig() : null));
	ipcMain.handle('vision-voice-config-set', (event, change) => {
		if (!fromOrb(event)) throw new Error('not allowed');
		return applyVoiceSettings(change);
	});
	ipcMain.handle('vision-voice-keys-save', (event, keys) => {
		if (!fromOrb(event)) throw new Error('not allowed');
		const clean = {};
		for (const { name } of VOICE_KEY_FIELDS) {
			const value = String(keys?.[name] ?? '').trim();
			if (!value) throw new Error(`${name} is empty`);
			clean[name] = value;
		}
		voiceSettings.saveKeys(clean);
		Object.assign(voiceKeys, clean);
		preflight = { ...preflight, keys: true };
		sendBusState();
		console.log('[VISION] Voice keys saved; starting the voice agent');
		busReady.then(() => agentSupervisor.restart());
		return voiceConfig();
	});

	audioDuck = createAudioDuck({
		file: path.join(app.getPath('userData'), 'audio-duck.json'),
		ownPids: () => app.getAppMetrics().map((metric) => metric.pid),
		// QA runs: only the test's own silent player is lowered, never the owner's apps.
		onlyPids: process.env.VISION_DUCK_ONLY_PIDS ? process.env.VISION_DUCK_ONLY_PIDS.split(',').map(Number) : null,
	});
	orb = createOrbWindow({
		preloadPath: path.join(appPath, 'src/preload-orb.js'),
		iconPath: path.join(__dirname, '../../images/vision/vision.ico'),
		consoleDir: app.isPackaged ? path.join(process.resourcesPath, 'console') : path.join(appPath, '..', 'console', 'out'),
		// Dev with hot reload: VISION_CONSOLE_URL=http://127.0.0.1:3000 and `pnpm dev` in console/.
		consoleUrl: process.env.VISION_CONSOLE_URL,
		getConnectionDetails: (options) => createConnectionDetails(voiceKeys, options),
		onVoiceState: setAssistantState,
		wakeModelDir: app.isPackaged ? path.join(process.resourcesPath, 'kws') : path.join(appPath, 'models', 'kws'),
		hidden: process.env.VISION_QUIET === '1',
	});

	agentSupervisor = createAgentSupervisor({
		command: resolveAgentCommand({ isPackaged: app.isPackaged, appPath, resourcesPath: process.resourcesPath }),
		getEnv: () => ({
			...voiceKeys,
			VISION_BUS_PORT: process.env.VISION_BUS_PORT,
			VISION_BUS_TOKEN: process.env.VISION_BUS_TOKEN,
			// Read by the agent at the start of every voice session (voice, language).
			VISION_SETTINGS_FILE: voiceSettings.settingsFile,
		}),
		logFile: agentLogFile,
		onGiveUp: () => console.error('[VISION] The voice assistant stopped working. Face control still works.'),
	});
	if (!keysOk) {
		console.log('[VISION] Voice keys missing: voice is off until they are added in Settings; face control works');
		return;
	}
	busReady.then(() => agentSupervisor.start());
}

let voiceSettings = null;
let audioDuck = null;

/** Voice / language change from Settings or by voice. Applies to the next voice session. */
function applyVoiceSettings(change) {
	const next = voiceSettings.update({ voice: change?.voice, language: change?.language });
	console.log(`[VISION] Voice settings: ${next.voice}, language ${next.language}`);
	orb?.getWindow()?.webContents.send('vision-voice-config-changed', next);
	return next;
}

app.on('will-quit', () => {
	audioDuck?.restore();
	agentSupervisor?.stop();
	orb?.destroy();
});

// Installed (NSIS) builds: download updates from GitHub Releases in the background and
// install them on the next quit. Never in dev, the Microsoft Store build or QA runs.
function startAutoUpdates() {
	if (!app.isPackaged || process.windowsStore || process.env.VISION_NO_UPDATES === '1') return;
	try {
		const { autoUpdater } = require('electron-updater');
		autoUpdater.logger = console;
		autoUpdater.on('update-downloaded', (info) => console.log(`[VISION] Update ${info.version} downloaded; installs on quit`));
		autoUpdater.checkForUpdates().catch((error) => console.log('[VISION] Update check failed:', error?.message ?? error));
	} catch (error) {
		console.error('[VISION] Updater unavailable:', error);
	}
}
