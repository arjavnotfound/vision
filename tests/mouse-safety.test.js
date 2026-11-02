const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createMouseSafetyCoordinator } = require('../app/src/electron-main/mouse-safety');

describe('MouseSafetyCoordinator', () => {
	it('initializes with all mouse buttons in released (false) state', () => {
		const safety = createMouseSafetyCoordinator();
		assert.deepEqual(safety.getButtonStates(), {
			left: false,
			right: false,
			middle: false,
		});
		assert.equal(safety.isAnyButtonDown(), false);
	});

	it('presses button down when clicking is allowed and calls mouseDown', async () => {
		const calls = [];
		const safety = createMouseSafetyCoordinator({
			mouseDown: async (btn) => { calls.push(`down:${btn}`); },
			mouseUp: async (btn) => { calls.push(`up:${btn}`); },
			getClickingAllowed: () => true,
		});

		const pressed = await safety.setMouseButtonState('left', true);
		assert.equal(pressed, true);
		assert.equal(safety.getButtonStates().left, true);
		assert.equal(safety.isAnyButtonDown(), true);
		assert.deepEqual(calls, ['down:left']);
	});

	it('releases button and calls mouseUp driver', async () => {
		const calls = [];
		const safety = createMouseSafetyCoordinator({
			mouseDown: async (btn) => { calls.push(`down:${btn}`); },
			mouseUp: async (btn) => { calls.push(`up:${btn}`); },
			getClickingAllowed: () => true,
		});

		await safety.setMouseButtonState('left', true);
		const released = await safety.setMouseButtonState('left', false);

		assert.equal(released, true);
		assert.equal(safety.getButtonStates().left, false);
		assert.equal(safety.isAnyButtonDown(), false);
		assert.deepEqual(calls, ['down:left', 'up:left']);
	});

	it('FAIL-SAFE: prevents pressing button down when clicking is disallowed', async () => {
		const calls = [];
		const safety = createMouseSafetyCoordinator({
			mouseDown: async (btn) => { calls.push(`down:${btn}`); },
			mouseUp: async (btn) => { calls.push(`up:${btn}`); },
			getClickingAllowed: () => false, // e.g. tracking paused, manual takeover
		});

		const pressed = await safety.setMouseButtonState('left', true);
		assert.equal(pressed, false);
		assert.equal(safety.getButtonStates().left, false);
		assert.equal(safety.isAnyButtonDown(), false);
		assert.equal(calls.length, 0);
	});

	it('FAIL-SAFE: ALWAYS permits releasing button even when clicking is disallowed', async () => {
		let clickingAllowed = true;
		const calls = [];
		const safety = createMouseSafetyCoordinator({
			mouseDown: async (btn) => { calls.push(`down:${btn}`); },
			mouseUp: async (btn) => { calls.push(`up:${btn}`); },
			getClickingAllowed: () => clickingAllowed,
		});

		// 1. Button is held down while tracking was active
		await safety.setMouseButtonState('left', true);
		assert.equal(safety.getButtonStates().left, true);

		// 2. Tracking paused or manual takeover occurs -> clicking is disallowed
		clickingAllowed = false;
		assert.equal(safety.isClickingAllowed(), false);

		// 3. Releasing MUST succeed despite clicking disallowed
		const released = await safety.setMouseButtonState('left', false);
		assert.equal(released, true);
		assert.equal(safety.getButtonStates().left, false);
		assert.equal(safety.isAnyButtonDown(), false);
		assert.deepEqual(calls, ['down:left', 'up:left']);
	});

	it('FAIL-SAFE: releaseAllMouseButtons releases all currently held buttons', async () => {
		const calls = [];
		let safetyReleasedNotice = null;
		const safety = createMouseSafetyCoordinator({
			mouseDown: async (btn) => { calls.push(`down:${btn}`); },
			mouseUp: async (btn) => { calls.push(`up:${btn}`); },
			getClickingAllowed: () => true,
			onSafetyRelease: (buttons, reason) => {
				safetyReleasedNotice = { buttons, reason };
			},
		});

		await safety.setMouseButtonState('left', true);
		await safety.setMouseButtonState('middle', true);
		assert.equal(safety.isAnyButtonDown(), true);

		const released = await safety.releaseAllMouseButtons('test-tracking-lost');
		assert.deepEqual(released, ['left', 'middle']);
		assert.equal(safety.isAnyButtonDown(), false);
		assert.deepEqual(safetyReleasedNotice, {
			buttons: ['left', 'middle'],
			reason: 'test-tracking-lost',
		});
		assert.deepEqual(calls, ['down:left', 'down:middle', 'up:left', 'up:middle']);
	});

	it('FAIL-SAFE: emergencyReleaseSync releases buttons synchronously using emergency driver', () => {
		const syncCalls = [];
		const safety = createMouseSafetyCoordinator({
			emergencyMouseUpSync: (btn) => { syncCalls.push(`sync-up:${btn}`); },
			getClickingAllowed: () => true,
		});

		// Manually mark button down
		safety.setMouseButtonState('right', true);

		const released = safety.emergencyReleaseSync('process-uncaught-exception');
		assert.deepEqual(released, ['right']);
		assert.equal(safety.isAnyButtonDown(), false);
		assert.deepEqual(syncCalls, ['sync-up:right']);
	});

	it('handles button swap (left <-> right) correctly', async () => {
		const calls = [];
		const safety = createMouseSafetyCoordinator({
			mouseDown: async (btn) => { calls.push(`down:${btn}`); },
			mouseUp: async (btn) => { calls.push(`up:${btn}`); },
			getClickingAllowed: () => true,
		});

		// Pass 'left' button (0) with swapButtons = true -> should activate 'right'
		await safety.setMouseButtonState(0, true, true);
		assert.equal(safety.getButtonStates().right, true);
		assert.equal(safety.getButtonStates().left, false);
		assert.deepEqual(calls, ['down:right']);

		// Release 'left' (0) with swapButtons = true -> should release 'right'
		await safety.setMouseButtonState(0, false, true);
		assert.equal(safety.getButtonStates().right, false);
		assert.deepEqual(calls, ['down:right', 'up:right']);
	});

	it('recovers cleanly if mouse driver throws an error', async () => {
		const safety = createMouseSafetyCoordinator({
			mouseDown: async () => { throw new Error('Native I/O failure'); },
			mouseUp: async () => { throw new Error('Native I/O failure'); },
			getClickingAllowed: () => true,
		});

		// If mouseDown throws, state must remain false
		const result = await safety.setMouseButtonState('left', true);
		assert.equal(result, false);
		assert.equal(safety.getButtonStates().left, false);

		// If releaseAllMouseButtons encounters error, it must not throw unhandled exception
		await assert.doesNotReject(async () => {
			await safety.releaseAllMouseButtons('test-error-handling');
		});
	});

	it('attaches window safety listeners: blur keeps a drag alive, crash releases', async () => {
		const calls = [];
		const mockWindow = new EventEmitter();
		mockWindow.webContents = new EventEmitter();

		const safety = createMouseSafetyCoordinator({
			mouseDown: async (btn) => { calls.push(`down:${btn}`); },
			mouseUp: async (btn) => { calls.push(`up:${btn}`); },
			getClickingAllowed: () => true,
		});

		safety.attachWindowSafetyListeners(mockWindow, 'test-appWindow');

		// Press button down
		await safety.setMouseButtonState('left', true);
		assert.equal(safety.isAnyButtonDown(), true);

		// Blur happens when a hands-free press lands on another app's window.
		// Releasing here would break the drag the user just started.
		mockWindow.emit('blur');
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.equal(safety.isAnyButtonDown(), true);
		assert.ok(!calls.includes('up:left'));

		// Window closed: everything is released
		mockWindow.emit('closed');
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.equal(safety.isAnyButtonDown(), false);
		assert.ok(calls.includes('up:left'));

		// Press button down again
		await safety.setMouseButtonState('middle', true);
		assert.equal(safety.isAnyButtonDown(), true);

		// Trigger render-process-gone
		mockWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.equal(safety.isAnyButtonDown(), false);
		assert.ok(calls.includes('up:middle'));
	});

	it('attaches app safety listeners and releases buttons on will-quit', async () => {
		const calls = [];
		const mockApp = new EventEmitter();

		const safety = createMouseSafetyCoordinator({
			mouseDown: async (btn) => { calls.push(`down:${btn}`); },
			mouseUp: async (btn) => { calls.push(`up:${btn}`); },
			getClickingAllowed: () => true,
		});

		safety.attachAppSafetyListeners(mockApp);

		await safety.setMouseButtonState('right', true);
		assert.equal(safety.isAnyButtonDown(), true);

		mockApp.emit('will-quit');
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.equal(safety.isAnyButtonDown(), false);
		assert.ok(calls.includes('up:right'));
	});

	it('releases synchronously on will-quit when a sync driver exists', () => {
		const syncCalls = [];
		const mockApp = new EventEmitter();
		const safety = createMouseSafetyCoordinator({
			emergencyMouseUpSync: (btn) => { syncCalls.push(`sync-up:${btn}`); },
			getClickingAllowed: () => true,
		});
		safety.attachAppSafetyListeners(mockApp);
		safety.setMouseButtonState('left', true);
		mockApp.emit('will-quit');
		assert.equal(safety.isAnyButtonDown(), false);
		assert.deepEqual(syncCalls, ['sync-up:left']);
	});

	it('releases on before-quit', async () => {
		const calls = [];
		const mockApp = new EventEmitter();
		const safety = createMouseSafetyCoordinator({
			mouseUp: async (btn) => { calls.push(`up:${btn}`); },
			getClickingAllowed: () => true,
		});
		safety.attachAppSafetyListeners(mockApp);
		await safety.setMouseButtonState('left', true);
		mockApp.emit('before-quit');
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.deepEqual(calls, ['up:left']);
	});

	it('WATCHDOG: enforceClickingGate releases held buttons as soon as clicking becomes disallowed', async () => {
		let allowed = true;
		const calls = [];
		const safety = createMouseSafetyCoordinator({
			mouseDown: async (btn) => { calls.push(`down:${btn}`); },
			mouseUp: async (btn) => { calls.push(`up:${btn}`); },
			getClickingAllowed: () => allowed,
		});
		await safety.setMouseButtonState('left', true);
		// Still allowed: watchdog does nothing
		assert.deepEqual(await safety.enforceClickingGate('tick'), []);
		assert.equal(safety.isAnyButtonDown(), true);
		// Paused / F9 / takeover / window gone: next tick releases
		allowed = false;
		assert.deepEqual(await safety.enforceClickingGate('tick'), ['left']);
		assert.equal(safety.isAnyButtonDown(), false);
		assert.deepEqual(calls, ['down:left', 'up:left']);
	});

	it('emergencyReleaseSync falls back to the async driver when no sync driver exists', () => {
		const calls = [];
		const safety = createMouseSafetyCoordinator({
			mouseUp: async (btn) => { calls.push(`up:${btn}`); },
			getClickingAllowed: () => true,
		});
		safety.setMouseButtonState('right', true);
		safety.emergencyReleaseSync('test');
		assert.deepEqual(calls, ['up:right']);
	});

	it('attaches process safety listeners and releases buttons synchronously on process exit', () => {
		const syncCalls = [];
		const mockProcess = new EventEmitter();

		const safety = createMouseSafetyCoordinator({
			emergencyMouseUpSync: (btn) => { syncCalls.push(`sync-up:${btn}`); },
			getClickingAllowed: () => true,
		});

		safety.attachProcessSafetyListeners(mockProcess);

		// Simulate button down
		safety.setMouseButtonState('left', true);

		// Trigger process exit event
		mockProcess.emit('exit');
		assert.equal(safety.isAnyButtonDown(), false);
		assert.deepEqual(syncCalls, ['sync-up:left']);
	});
});
