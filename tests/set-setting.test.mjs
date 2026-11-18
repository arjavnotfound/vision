import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applySetting } from "../app/src/ui/js/set-setting.js";
import { sensitivityLevel } from "../app/src/ui/js/controls.js";
import { parseVolume, sanitizeGlobal, islandSettings } from "../app/src/electron-main/settings-migrate.js";

function fakeApp(values = {}) {
	const store = { headTrackingSensitivityX: 0.025, headTrackingSensitivityY: 0.025, dwellTime: 800, ...values };
	let paused = false;
	return {
		store,
		get paused() { return paused; },
		st: { get: (k) => store[k], set: (k, v) => { store[k] = v; }, has: (k) => k in store },
		engine: { setPaused: (v) => { paused = v; } },
	};
}

describe("Voice set_setting bridge", () => {
	it("moves cursor speed one Settings step, or to a level 1-10", () => {
		const app = fakeApp();
		assert.equal(applySetting("cursor_speed", "slower", app).value, 4);
		assert.equal(sensitivityLevel(app.store.headTrackingSensitivityX), 4);
		assert.equal(applySetting("cursor_speed", "8", app).value, 8);
		assert.equal(applySetting("cursor_speed", 11, app).done, "none");
		assert.equal(applySetting("cursor_speed", "fast-ish", app).done, "none");
		assert.equal(sensitivityLevel(app.store.headTrackingSensitivityX), 8);
	});

	it("says so at the end of the range instead of claiming a change", () => {
		const app = fakeApp({ dwellTime: 2000 });
		const reply = applySetting("dwell_time", "longer", app);
		assert.equal(reply.done, "none");
		assert.match(reply.error, /longest/);
	});

	it("takes dwell time in seconds or milliseconds and rejects out-of-range values", () => {
		const app = fakeApp();
		assert.equal(applySetting("dwell_time", "1.2", app).value, 1200);
		assert.equal(app.store.dwellTime, 1200);
		assert.equal(applySetting("dwell_time", 1000, app).value, 1000);
		assert.equal(applySetting("dwell_time", "shorter", app).value, 900);
		for (const bad of ["0.3", "5000", "", "soon"]) {
			assert.equal(applySetting("dwell_time", bad, app).done, "none", bad);
		}
		assert.equal(app.store.dwellTime, 900);
	});

	it("pauses and resumes; face control off means paused", () => {
		const app = fakeApp();
		assert.equal(applySetting("paused", "on", app).done, "paused");
		assert.equal(app.paused, true);
		assert.equal(applySetting("face_control", "on", app).done, "resumed");
		assert.equal(app.paused, false);
		assert.equal(applySetting("face_control", "off", app).done, "paused");
		assert.equal(applySetting("paused", "maybe", app).done, "none");
	});

	it("refuses names outside the whitelist", () => {
		const app = fakeApp();
		assert.equal(applySetting("clickingMode", "off", app).done, "none");
		assert.equal(applySetting("__proto__", "x", app).done, "none");
	});

	it("range-checks volume in the settings store", () => {
		assert.equal(parseVolume("60"), 60);
		assert.equal(parseVolume("louder", 90), 100);
		assert.equal(parseVolume("quieter", 20), 10);
		assert.equal(parseVolume("5"), null);
		assert.equal(parseVolume("150"), null);
		assert.equal(parseVolume("loud"), null);
		assert.equal(sanitizeGlobal({ voiceVolume: 0 }).voiceVolume, 100);
		assert.equal(islandSettings({ voiceVolume: 40 }).voiceVolume, 40);
		assert.equal(islandSettings({ soundVolume: 30, soundsOn: false }).soundVolume, 30);
		assert.equal(islandSettings({ soundsOn: false }).soundsOn, false);
		assert.equal(sanitizeGlobal({ soundVolume: 500 }).soundVolume, 60);
	});
	it("interrupting while VISION talks is off unless turned on", () => {
		assert.equal(islandSettings({}).allowInterrupt, false);
		assert.equal(islandSettings({ allowInterrupt: "yes" }).allowInterrupt, false);
		assert.equal(islandSettings({ allowInterrupt: true }).allowInterrupt, true);
	});
});
