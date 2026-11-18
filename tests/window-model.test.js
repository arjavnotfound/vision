// Tray-first window model: how the face window opens on each launch.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { planLaunch } = require('../app/src/electron-main/app-window');

describe('planLaunch', () => {
	it('opens the Start screen in a normal window on the first run', () => {
		assert.deepEqual(planLaunch({ firstRun: true, assistant: true, startEnabled: true }), { kiosk: true, start: true, maximize: false, hidden: false });
	});
	it('starts in the tray on later launches when tracking starts on launch', () => {
		assert.deepEqual(planLaunch({ firstRun: false, assistant: true, startEnabled: true }), { kiosk: true, start: false, maximize: false, hidden: true });
	});
	it('shows the window when tracking would start paused, so the user is not left with nothing', () => {
		assert.equal(planLaunch({ firstRun: false, assistant: true, startEnabled: false }).hidden, false);
	});
	it('keeps face control alone (synthetic QA) visible and without the hands-free UI', () => {
		assert.deepEqual(planLaunch({ firstRun: false, assistant: false, startEnabled: true }), { kiosk: false, start: false, maximize: false, hidden: false });
	});
	it('keeps the old full-screen Start screen only when VISION_ONE_APP=1 is set', () => {
		assert.deepEqual(planLaunch({ firstRun: false, assistant: true, oneAppEnv: '1', startEnabled: true }), { kiosk: true, start: true, maximize: true, hidden: false });
	});
});

// The island window: where it sits, what it draws, and when it takes the mouse.
const island = require('../app/src/electron-main/orb-window');

describe('island window', () => {
	const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1032 } };
	const rectFor = (shape, position, kind = 'island') => island.shapeRect(shape, position, island.islandWindowBounds(kind, position, display));

	it('is a 56x8 bar at top centre when idle, and a caption pill of at most 360x40', () => {
		assert.deepEqual(rectFor('idle', 'top-center'), { x: 932, y: 4, width: 56, height: 8 });
		const pill = rectFor('caption', 'top-center');
		assert.ok(pill.width <= 360 && pill.height <= 40);
	});
	it('sits top right, left of the caption buttons, or bottom centre', () => {
		const right = rectFor('idle', 'top-right');
		assert.ok(right.x + right.width <= 1920 - island.CAPTION_BUTTONS);
		assert.ok(right.x > 1920 / 2);
		const bottom = rectFor('idle', 'bottom-center');
		assert.equal(bottom.y + bottom.height, 1032 - 4);
		assert.equal(bottom.x, 932);
		assert.deepEqual(rectFor('idle', 'nonsense'), rectFor('idle', 'top-center'));
	});
	it('opens the menu away from the edge, below a browser tab strip at top right', () => {
		assert.equal(island.islandWindowBounds('menu', 'top-center', display).y, 0);
		assert.ok(island.islandWindowBounds('menu', 'top-right', display).y >= island.BROWSER_BAR);
		const up = island.islandWindowBounds('menu', 'bottom-center', display);
		assert.equal(up.y + up.height, 1032);
	});
	it('is a 40x3 line at the very top over a full-screen app', () => {
		assert.deepEqual(rectFor('line', 'bottom-center', 'line'), { x: 940, y: 0, width: 40, height: 3 });
	});
	it('is click-through in every state except the open menu', () => {
		for (const mode of ['idle', 'caption', 'line']) assert.equal(island.ignoresMouse(mode), true);
		assert.equal(island.ignoresMouse('menu'), false);
		assert.equal(island.ignoresMouse('controls'), false, 'Stop, Yes and No take a dwell');
	});
	it('has room for the 64 px Stop or Yes / No row under the caption', () => {
		const win = island.islandWindowBounds('controls', 'top-center', display);
		const shape = island.shapeRect('controls', 'top-center', win);
		assert.ok(shape.height >= 40 + 64 && shape.y + shape.height <= win.y + win.height);
	});
	it('fades within 80 px of the shape', () => {
		const bar = rectFor('idle', 'top-center');
		assert.ok(island.distanceTo({ x: 960, y: 80 }, bar) <= island.FADE_NEAR);
		assert.ok(island.distanceTo({ x: 960, y: 100 }, bar) > island.FADE_NEAR);
		assert.equal(island.distanceTo({ x: 960, y: 8 }, bar), 0);
	});
	it('opens only after a 1.5 s dwell; passing over or resting there at launch never opens it', () => {
		const dwell = island.createDwell(1500);
		assert.equal(dwell.update(true, 0).fire, false, 'a pointer already resting there at launch');
		assert.equal(dwell.update(true, 2000).fire, false);
		dwell.update(false, 2100);
		let fired = false;
		for (let t = 2200; t < 3500; t += 50) fired ||= dwell.update(true, t).fire; // passes over for 1.3 s
		assert.equal(fired, false);
		dwell.update(false, 3500);
		assert.equal(dwell.update(true, 3550).progress, 0);
		assert.ok(Math.abs(dwell.update(true, 4300).progress - 0.5) < 1e-9, 'the ring fills');
		assert.equal(dwell.update(true, 5050).fire, true);
		assert.equal(dwell.update(true, 7000).fire, false, 'must leave before it can open again');
	});
	it('closes the menu after 8 s without the cursor, or when the cursor is 200 px away', () => {
		const rect = { x: 790, y: 0, width: 340, height: 520 };
		assert.equal(island.menuShouldClose({ cursor: { x: 900, y: 100 }, rect, lastOverAt: 0, now: 7000 }), false);
		assert.equal(island.menuShouldClose({ cursor: { x: 1200, y: 100 }, rect, lastOverAt: 0, now: 1000 }), false);
		assert.equal(island.menuShouldClose({ cursor: { x: 1400, y: 100 }, rect, lastOverAt: 0, now: 1000 }), true);
		assert.equal(island.menuShouldClose({ cursor: { x: 1200, y: 100 }, rect, lastOverAt: 0, now: 8100 }), true);
	});
});
