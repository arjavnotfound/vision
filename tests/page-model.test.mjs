import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RAIL, resolvePage, settingsView, CLICK_PRESETS, matchPreset, matchCursorPreset, voiceStatus, faceStatus } from "../app/src/ui/js/pages/model.js";

describe("page model", () => {
	it("has the five rail items in order", () => {
		assert.deepEqual(RAIL.map((r) => r.label), ["Home", "Face control", "Voice", "Settings", "Help"]);
	});

	it("resolves page names and old commands", () => {
		assert.deepEqual(resolvePage("settings-voice"), { page: "settings", section: "voice", rail: "settings" });
		assert.deepEqual(resolvePage("about"), { page: "settings", section: "about", rail: "settings" });
		assert.equal(resolvePage("diagnostics").rail, "help");
		assert.equal(resolvePage("nonsense").page, "home");
		assert.equal(resolvePage("settings").section, null);
	});

	it("keeps unknown setting keys locally and passes known ones to the engine", () => {
		const engine = { a: 1 };
		const st = { has: (k) => k in engine, get: (k) => engine[k], set: (k, v) => { engine[k] = v; } };
		const view = settingsView(st);
		assert.equal(view.get("clickWink"), true);
		view.set("clickWink", false);
		assert.equal(view.get("clickWink"), false);
		assert.equal("clickWink" in engine, false);
		view.set("a", 2);
		assert.equal(engine.a, 2);
	});

	it("matches click and cursor presets", () => {
		const values = { clickWink: false, clickBlink: false, clickMouth: false, clickDwell: true };
		assert.equal(matchPreset(CLICK_PRESETS, (k) => values[k]).id, "dwell");
		values.clickWink = true;
		assert.equal(matchPreset(CLICK_PRESETS, (k) => values[k]), null);
		assert.equal(matchCursorPreset(5, 0.5).id, "normal");
		assert.equal(matchCursorPreset(5, 0.9), null);
	});

	it("always gives voice a state, a reason and an action when it is off", () => {
		assert.equal(voiceStatus({ available: true, config: { hasKeys: false } }).text, "Voice is off · Voice keys missing · Add keys");
		assert.equal(voiceStatus({ available: true, config: { hasKeys: true }, bus: { internet: false } }).text, "Voice is off · No internet · Try again");
		assert.equal(voiceStatus({ available: true, config: { hasKeys: true, agent: { state: "error", message: "401 Unauthorized" } } }).text, "Voice is off · Key not accepted · Check keys");
		assert.equal(voiceStatus({ available: true, config: { hasKeys: true, agent: { state: "ready" } }, wakePhrase: "vision" }).text, "Voice is ready · Say “Vision”");
		assert.equal(voiceStatus({ available: true, config: { hasKeys: true, agent: { state: "ready" } } }).off, false);
		assert.equal(voiceStatus({ available: false }).off, true);
	});

	it("says how to resume with the chosen pause method", () => {
		assert.match(faceStatus({ paused: true }, "closeEyes").line, /Close your eyes/);
		assert.match(faceStatus({ paused: true }, "blinks3").line, /three times/);
		assert.match(faceStatus({ status: "tracking" }, "blinks3").title, /on/);
	});
});
