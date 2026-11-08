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
