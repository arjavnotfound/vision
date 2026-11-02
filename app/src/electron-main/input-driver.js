// Native mouse/keyboard input for VISION.
//
// Backend order (first one that works wins, per call):
//   1. Koffi + user32.dll (Windows). Pure FFI, no C++ toolchain needed. PRIMARY.
//   2. serenade-driver native addon. OPTIONAL fallback; may be absent.
//   3. Electron's screen API (cursor position only).
//
// Every backend call is wrapped in an error boundary: a failing backend logs once
// and the next backend is tried, so a broken optional dependency can never take
// down the app or leave a button held.

const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;
const MOUSEEVENTF_MIDDLEDOWN = 0x0020;
const MOUSEEVENTF_MIDDLEUP = 0x0040;

const KEYEVENTF_KEYUP = 0x0002;
const VK_MAP = {
	up: 0x26,
	down: 0x28,
	left: 0x25,
	right: 0x27,
	return: 0x0d,
	enter: 0x0d,
	escape: 0x1b,
	space: 0x20,
	tab: 0x09,
	backspace: 0x08,
	delete: 0x2e,
	home: 0x24,
	end: 0x23,
	pageup: 0x21,
	pagedown: 0x22,
};

function buttonFlag(button, down) {
	if (button === 'right') return down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
	if (button === 'middle') return down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
	return down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
}

/** Loads the Koffi user32 bindings, or returns null (never throws). */
function loadKoffiUser32() {
	if (process.platform !== 'win32') {
		return null;
	}
	try {
		const koffi = require('koffi');
		const user32 = koffi.load('user32.dll');
		try {
			koffi.struct('POINT', { x: 'long', y: 'long' });
		} catch (_error) {
			// Already registered by an earlier load in this process.
		}
		return {
			GetCursorPos: user32.func('bool GetCursorPos(_Out_ POINT* lpPoint)'),
			SetCursorPos: user32.func('bool SetCursorPos(int x, int y)'),
			mouse_event: user32.func('void mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, uint32 dwData, uintptr dwExtraInfo)'),
			keybd_event: user32.func('void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)'),
		};
	} catch (error) {
		console.warn('[input-driver] Koffi user32 bindings unavailable:', error?.message || error);
		return null;
	}
}

/** Loads the optional serenade-driver addon, or returns null (never throws). */
function loadSerenade() {
	try {
		return require('serenade-driver');
	} catch (_error) {
		return null;
	}
}

function loadElectronScreen() {
	try {
		return require('electron').screen || null;
	} catch (_error) {
		return null;
	}
}

/**
 * @param {object} [deps] injectable for tests
 * @param {() => any} [deps.loadKoffi]
 * @param {() => any} [deps.loadSerenade]
 * @param {() => any} [deps.loadScreen]
 * @param {(msg: string, err: any) => void} [deps.warn]
 */
function createInputDriver({
	loadKoffi = loadKoffiUser32,
	loadSerenade: loadSerenadeImpl = loadSerenade,
	loadScreen = loadElectronScreen,
	warn = (msg, err) => console.warn(msg, err?.message || err),
} = {}) {
	const koffi = loadKoffi();
	// Only load the optional addon lazily if Koffi is unavailable or a call fails.
	let serenade;
	const getSerenade = () => {
		if (serenade === undefined) {
			serenade = loadSerenadeImpl() || null;
		}
		return serenade;
	};

	const warned = new Set();
	const warnOnce = (key, err) => {
		if (!warned.has(key)) {
			warned.add(key);
			warn(`[input-driver] ${key} failed; falling back.`, err);
		}
	};

	async function getMouseLocation() {
		if (koffi) {
			try {
				const pt = {};
				koffi.GetCursorPos(pt);
				return { x: pt.x || 0, y: pt.y || 0 };
			} catch (err) {
				warnOnce('koffi.GetCursorPos', err);
			}
		}
		const s = getSerenade();
		if (s && typeof s.getMouseLocation === 'function') {
			try {
				return await s.getMouseLocation();
			} catch (err) {
				warnOnce('serenade.getMouseLocation', err);
			}
		}
		const screen = loadScreen();
		if (screen && typeof screen.getCursorScreenPoint === 'function') {
			try {
				return screen.getCursorScreenPoint();
			} catch (err) {
				warnOnce('screen.getCursorScreenPoint', err);
			}
		}
		return { x: 0, y: 0 };
	}

	async function setMouseLocation(x, y) {
		if (koffi) {
			try {
				koffi.SetCursorPos(Math.round(x), Math.round(y));
				return;
			} catch (err) {
				warnOnce('koffi.SetCursorPos', err);
			}
		}
		const s = getSerenade();
		if (s && typeof s.setMouseLocation === 'function') {
			try {
				await s.setMouseLocation(x, y);
			} catch (err) {
				warnOnce('serenade.setMouseLocation', err);
			}
		}
	}

	// Synchronous when Koffi is available, which matters for release-on-exit paths.
	function mouseButtonSync(button, down) {
		if (!koffi) return false;
		try {
			koffi.mouse_event(buttonFlag(button, down), 0, 0, 0, 0);
			return true;
		} catch (err) {
			warnOnce(`koffi.mouse_event(${down ? 'down' : 'up'})`, err);
			return false;
		}
	}

	async function mouseButton(button, down) {
		if (mouseButtonSync(button, down)) {
			return;
		}
		const s = getSerenade();
		const fn = down ? s?.mouseDown : s?.mouseUp;
		if (typeof fn === 'function') {
			try {
				await fn.call(s, button);
			} catch (err) {
				warnOnce(`serenade.${down ? 'mouseDown' : 'mouseUp'}`, err);
			}
		}
	}

	const mouseDown = (button = 'left') => mouseButton(button, true);
	const mouseUp = (button = 'left') => mouseButton(button, false);
	const mouseUpSync = (button = 'left') => {
		mouseButtonSync(button, false);
	};

	async function click(button = 'left', count = 1) {
		for (let i = 0; i < count; i++) {
			await mouseDown(button);
			await mouseUp(button);
		}
	}

	async function pressKey(key, modifiers = [], count = 1) {
		const vk = VK_MAP[String(key).toLowerCase()] || 0;
		if (koffi && vk) {
			try {
				for (let i = 0; i < count; i++) {
					koffi.keybd_event(vk, 0, 0, 0);
					koffi.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
				}
				return;
			} catch (err) {
				warnOnce('koffi.keybd_event', err);
			}
		}
		const s = getSerenade();
		if (s && typeof s.pressKey === 'function') {
			try {
				await s.pressKey(key, modifiers, count);
			} catch (err) {
				warnOnce('serenade.pressKey', err);
			}
		}
	}

	function describe() {
		return koffi ? 'koffi-user32' : (getSerenade() ? 'serenade-driver' : 'electron-screen-only');
	}

	return {
		getMouseLocation,
		setMouseLocation,
		mouseDown,
		mouseUp,
		mouseUpSync,
		click,
		pressKey,
		describe,
	};
}

/**
 * QA only (env VISION_FAKE_INPUT=<log file>): never touches the real mouse. Records every
 * press/release synchronously (so releases during quit are captured) and can simulate a
 * physical mouse movement for manual-takeover tests.
 */
function createFakeDriver(logPath) {
	const fs = require('fs');
	let pos = { x: 500, y: 400 };
	const log = (entry) => {
		try {
			fs.appendFileSync(logPath, JSON.stringify({ t: Date.now(), ...entry }) + "\n");
		} catch (_error) {
			// ignore
		}
	};
	log({ op: 'start' });
	return {
		getMouseLocation: async () => ({ ...pos }),
		setMouseLocation: async (x, y) => {
			pos = { x: Math.round(x), y: Math.round(y) };
		},
		mouseDown: async (button = 'left') => log({ op: 'down', button }),
		mouseUp: async (button = 'left') => log({ op: 'up', button }),
		mouseUpSync: (button = 'left') => log({ op: 'up', button, sync: true }),
		click: async (button = 'left') => {
			log({ op: 'down', button, via: 'click' });
			log({ op: 'up', button, via: 'click' });
		},
		pressKey: async (key) => log({ op: 'key', key }),
		describe: () => 'fake (QA log)',
		simulatePhysicalMove(dx, dy) {
			pos = { x: pos.x + dx, y: pos.y + dy };
			log({ op: 'physical-move', dx, dy });
		},
	};
}

// Default singleton used by the app.
const defaultDriver = process.env.VISION_FAKE_INPUT ? createFakeDriver(process.env.VISION_FAKE_INPUT) : createInputDriver();

module.exports = {
	...defaultDriver,
	createInputDriver,
	createFakeDriver,
	buttonFlag,
};
