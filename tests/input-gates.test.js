const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createScrollHandler, createOverlaySync, summarizeInputFeedback } = require('../app/src/electron-main/input-gates');

describe('scrollMouse handler (AUDIT 2.1: isClickingAllowed scope bug)', () => {
	it('scrolls when allowed, using arrow keys in the right direction', async () => {
		const keys = [];
		let t = 0;
		const handle = createScrollHandler({ isClickingAllowed: () => true, pressKey: async (k) => { keys.push(k); }, now: () => t });
		assert.equal(await handle(-1), true);
		t += 100;
		assert.equal(await handle(1), true);
		assert.deepEqual(keys, ['up', 'down']);
	});

	it('refuses to scroll when clicking is not allowed (paused / takeover)', async () => {
		const keys = [];
		const handle = createScrollHandler({ isClickingAllowed: () => false, pressKey: async (k) => { keys.push(k); } });
		assert.equal(await handle(1), false);
		assert.deepEqual(keys, []);
	});

	it('throttles to one scroll step per 35 ms', async () => {
		const keys = [];
		let t = 0;
		const handle = createScrollHandler({ isClickingAllowed: () => true, pressKey: async (k) => { keys.push(k); }, now: () => t });
		await handle(1);
		t = 10;
		assert.equal(await handle(1), false);
		t = 40;
		assert.equal(await handle(1), true);
		assert.equal(keys.length, 2);
	});

	it('survives a failing key driver', async () => {
		const handle = createScrollHandler({ isClickingAllowed: () => true, pressKey: async () => { throw new Error('boom'); }, log: () => { } });
		assert.equal(await handle(1), false);
	});

	it('requires a real gate function (the original bug was an undefined gate)', () => {
		assert.throws(() => createScrollHandler({ isClickingAllowed: undefined, pressKey: async () => { } }));
	});

	it('electron-main declares isClickingAllowed at module scope, not inside app.on("ready")', () => {
		const source = fs.readFileSync(path.join(__dirname, '../app/src/electron-main/electron-main.js'), 'utf8');
		assert.match(source, /^function isClickingAllowed\(\)/m, 'isClickingAllowed must be a top-level function');
		assert.match(source, /createScrollHandler\(\{ isClickingAllowed, pressKey \}\)/);
	});
});

describe('Overlay update coalescing (AUDIT 2.2)', () => {
	function harness() {
		const sent = [];
		const timers = [];
		let t = 0;
		const sync = createOverlaySync({
			send: (p) => { sent.push(p); return true; },
			minIntervalMs: 16,
			now: () => t,
			schedule: (fn, ms) => { timers.push({ fn, at: t + ms }); return timers.length; },
			cancel: () => { },
		});
		// Runs only the timers that are due at the current fake time.
		const runTimers = () => {
			for (let i = 0; i < timers.length;) {
				if (timers[i].at <= t) {
					const [timer] = timers.splice(i, 1);
					timer.fn();
				} else {
					i++;
				}
			}
		};
		return { sent, sync, runTimers, advance: (ms) => { t += ms; } };
	}

	it('sends many requests within one frame as a single update', () => {
		const { sent, sync, runTimers } = harness();
		for (let i = 0; i < 10; i++) {
			sync.request(() => ({ x: i }));
		}
		runTimers();
		assert.deepEqual(sent, [{ x: 9 }]);
		for (let i = 10; i < 20; i++) {
			sync.request(() => ({ x: i }));
		}
		runTimers();
		assert.equal(sent.length, 1, "second burst waits for the 16 ms interval");
	});

	it('does not resend an unchanged payload', () => {
		const { sent, sync, runTimers, advance } = harness();
		sync.request(() => ({ x: 1 }));
		runTimers();
		advance(100);
		sync.request(() => ({ x: 1 }));
		advance(20);
		runTimers();
		assert.equal(sent.length, 1);
		advance(100);
		sync.request(() => ({ x: 2 }));
		advance(20);
		runTimers();
		assert.equal(sent.length, 2);
	});

	it('limits sends to about 60 Hz', () => {
		const { sent, sync, runTimers, advance } = harness();
		// 100 Hz of changing requests for one second
		for (let i = 0; i < 100; i++) {
			sync.request(() => ({ x: i }));
			advance(10);
			runTimers();
		}
		assert.ok(sent.length <= 63, `sent ${sent.length} updates in 1s`);
		assert.ok(sent.length >= 45, `sent ${sent.length} updates in 1s`);
	});

	it('invalidate() forces the next update through (e.g. after overlay reload)', () => {
		const { sent, sync, runTimers, advance } = harness();
		sync.request(() => ({ x: 1 }));
		runTimers();
		sync.invalidate();
		advance(20);
		sync.request(() => ({ x: 1 }));
		advance(20);
		runTimers();
		assert.equal(sent.length, 2);
	});

	it('summarizes input feedback to just what the overlay draws', () => {
		const contour = Array.from({ length: 20 }, (_, i) => [i, i]);
		const summary = summarizeInputFeedback({
			headNotFound: false,
			blinkInfo: { used: true, leftEye: { heightRatio: 0.123456, active: true, thresholdMet: true, upperContour: contour }, rightEye: { heightRatio: 0.3, active: false, thresholdMet: false } },
			mouthInfo: { used: false, heightRatio: 0.1, active: false, thresholdMet: false, lowerContour: contour },
			eyebrowGestureProgress: 0.333,
		});
		assert.deepEqual(summary, {
			headNotFound: false,
			blinkInfo: { used: true, leftEye: { heightRatio: 0.123, active: true, thresholdMet: true }, rightEye: { heightRatio: 0.3, active: false, thresholdMet: false } },
			mouthInfo: { used: false, heightRatio: 0.1, active: false, thresholdMet: false },
			eyebrowGestureProgress: 0.33,
		});
	});
});
