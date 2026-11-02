const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createInputDriver, buttonFlag } = require('../app/src/electron-main/input-driver');

function fakeKoffi(log, { throwOn = [] } = {}) {
	const maybeThrow = (name) => {
		if (throwOn.includes(name)) throw new Error(`${name} exploded`);
	};
	return {
		GetCursorPos(pt) { maybeThrow('GetCursorPos'); pt.x = 11; pt.y = 22; return true; },
		SetCursorPos(x, y) { maybeThrow('SetCursorPos'); log.push(`koffi.set:${x},${y}`); return true; },
		mouse_event(flags) { maybeThrow('mouse_event'); log.push(`koffi.mouse:${flags}`); },
		keybd_event(vk, _scan, flags) { maybeThrow('keybd_event'); log.push(`koffi.key:${vk}:${flags}`); },
	};
}

function fakeSerenade(log) {
	return {
		getMouseLocation: async () => ({ x: 1, y: 2 }),
		setMouseLocation: async (x, y) => { log.push(`serenade.set:${x},${y}`); },
		mouseDown: async (b) => { log.push(`serenade.down:${b}`); },
		mouseUp: async (b) => { log.push(`serenade.up:${b}`); },
		pressKey: async (k) => { log.push(`serenade.key:${k}`); },
	};
}

const quiet = () => { };

describe('Input driver', () => {
	it('uses Koffi user32 as the primary backend and never loads serenade when Koffi works', async () => {
		const log = [];
		let serenadeLoaded = false;
		const driver = createInputDriver({
			loadKoffi: () => fakeKoffi(log),
			loadSerenade: () => { serenadeLoaded = true; return fakeSerenade(log); },
			loadScreen: () => null,
			warn: quiet,
		});
		assert.equal(driver.describe(), 'koffi-user32');
		assert.deepEqual(await driver.getMouseLocation(), { x: 11, y: 22 });
		await driver.setMouseLocation(10.6, 20.2);
		await driver.mouseDown('left');
		await driver.mouseUp('left');
		await driver.mouseDown('right');
		await driver.mouseUp('right');
		await driver.pressKey('up');
		assert.deepEqual(log, [
			'koffi.set:11,20',
			`koffi.mouse:${buttonFlag('left', true)}`,
			`koffi.mouse:${buttonFlag('left', false)}`,
			`koffi.mouse:${buttonFlag('right', true)}`,
			`koffi.mouse:${buttonFlag('right', false)}`,
			'koffi.key:38:0',
			'koffi.key:38:2',
		]);
		assert.equal(serenadeLoaded, false);
	});

	it('falls back to serenade-driver when Koffi is unavailable', async () => {
		const log = [];
		const driver = createInputDriver({
			loadKoffi: () => null,
			loadSerenade: () => fakeSerenade(log),
			loadScreen: () => null,
			warn: quiet,
		});
		assert.equal(driver.describe(), 'serenade-driver');
		await driver.mouseDown('left');
		await driver.mouseUp('left');
		assert.deepEqual(log, ['serenade.down:left', 'serenade.up:left']);
	});

	it('falls back per call when a Koffi call throws, and keeps working', async () => {
		const log = [];
		const warnings = [];
		const driver = createInputDriver({
			loadKoffi: () => fakeKoffi(log, { throwOn: ['mouse_event'] }),
			loadSerenade: () => fakeSerenade(log),
			loadScreen: () => null,
			warn: (msg) => warnings.push(msg),
		});
		await driver.mouseDown('left');
		await driver.mouseUp('left');
		assert.deepEqual(log, ['serenade.down:left', 'serenade.up:left']);
		assert.equal(warnings.length, 2); // one per distinct failing call kind, not per call
	});

	it('never throws when no backend is available (fresh install without a C++ toolchain on a non-Windows box)', async () => {
		const driver = createInputDriver({
			loadKoffi: () => null,
			loadSerenade: () => null,
			loadScreen: () => null,
			warn: quiet,
		});
		assert.equal(driver.describe(), 'electron-screen-only');
		await assert.doesNotReject(async () => {
			await driver.setMouseLocation(1, 2);
			await driver.mouseDown('left');
			await driver.mouseUp('left');
			await driver.click('left');
			await driver.pressKey('down');
		});
		assert.doesNotThrow(() => driver.mouseUpSync('left'));
		assert.deepEqual(await driver.getMouseLocation(), { x: 0, y: 0 });
	});

	it('mouseUpSync releases synchronously through Koffi (used on process exit)', () => {
		const log = [];
		const driver = createInputDriver({ loadKoffi: () => fakeKoffi(log), loadSerenade: () => null, loadScreen: () => null, warn: quiet });
		driver.mouseUpSync('middle');
		assert.deepEqual(log, [`koffi.mouse:${buttonFlag('middle', false)}`]);
	});

	it('the desktop app does not require a native build step', () => {
		const pkg = require('../app/package.json');
		assert.equal(pkg.scripts.install, undefined, 'no node-gyp install script');
		assert.equal(pkg.dependencies['serenade-driver'], undefined, 'serenade-driver must be optional');
		assert.ok(pkg.optionalDependencies['serenade-driver']);
		assert.ok(pkg.dependencies.koffi, 'koffi is the primary driver');
	});
});
