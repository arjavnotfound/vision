// Issues one tiny relative mouse move on Windows, so the cursor becomes visible when
// VISION starts controlling the computer via "Run at login" (the cursor is otherwise
// invisible until the physical mouse is jostled; ShowCursor() does not help).
//
// Uses Koffi (user32 mouse_event with MOUSEEVENTF_MOVE). The old optional C++ addon
// (win_relative_mouse) is tried only if it happens to be built; it is not required.

let sentInitialRelativeMove = false;

function tryNativeAddon() {
	try {
		const bindings = require('bindings');
		const native = bindings('win_relative_mouse');
		if (native && typeof native.sendRelativeMouseMove === 'function') {
			native.sendRelativeMouseMove(1, 0);
			return true;
		}
	} catch (_error) {
		// Addon not built (no C++ toolchain); expected.
	}
	return false;
}

function tryKoffi() {
	try {
		const koffi = require('koffi');
		const user32 = koffi.load('user32.dll');
		const mouse_event = user32.func('void mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, uint32 dwData, uintptr dwExtraInfo)');
		const MOUSEEVENTF_MOVE = 0x0001;
		mouse_event(MOUSEEVENTF_MOVE, 1, 0, 0, 0);
		return true;
	} catch (_error) {
		return false;
	}
}

function ensureInitialRelativeMouseMove() {
	if (sentInitialRelativeMove || process.platform !== 'win32') {
		return;
	}
	sentInitialRelativeMove = true;
	if (!tryKoffi()) {
		tryNativeAddon();
	}
}

module.exports = {
	ensureInitialRelativeMouseMove,
};
