import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { meshPoints, pointAlpha, buildFace } from "../app/src/ui/js/face-mesh.js";
import { meterLevels, METERS } from "../app/src/ui/js/meters.js";
import { gestureRows } from "../app/src/ui/js/gesture-card.js";
import { lightLevel, readDiagnostics, clickMethodNames } from "../app/src/ui/js/diagnostics.js";
import { gestureSeen, createTryDetector, chooseMethods } from "../app/src/ui/js/onboarding.js";

const settings = (values) => ({ has: (k) => k in values, get: (k) => values[k] });
const thresholds = { eye: { low: 0.15, high: 0.2 }, mouth: { high: 0.3, low: 0.2 }, brow: { high: 0.3, low: 0.25 } };
const g = (over = {}) => ({ leftEye: { ratio: 0.28 }, rightEye: { ratio: 0.28 }, mouth: { ratio: 0.05 }, brow: { ratio: 0.22 }, sleep: { progress: 0 }, thresholds, ...over });

describe("Display mesh", () => {
	it("keeps every point of the preview face", () => {
		const face = buildFace();
		const pts = meshPoints({ mesh: { pts: face.pts.map((p) => [p.x, p.y, 0, false, p.k]) } });
		assert.equal(pts.length, face.pts.length);
	});
	it("draws all 468 face mesh landmarks", () => {
		const landmarks = Array.from({ length: 468 }, (_, i) => [i, i * 2]);
		const pts = meshPoints({ landmarks, contours: { silhouette: [[0, 0]] }, points: new Float32Array(88), pointCount: 44 });
		assert.equal(pts.length, 468);
		assert.deepEqual(pts[467], [467, 934]);
	});
	it("takes contour points, never flow points", () => {
		const loop = (n) => Array.from({ length: n }, (_, i) => [i, i]);
		const pts = meshPoints({ contours: { silhouette: loop(36), leftEyeUpper0: loop(9), leftEyeLower0: loop(9), rightEyeUpper0: loop(9), rightEyeLower0: loop(9), leftEyebrowUpper: loop(8), rightEyebrowUpper: loop(8), lipsUpperOuter: loop(11), lipsLowerOuter: loop(10) }, points: new Float32Array(88), pointCount: 44 });
		assert.ok(pts.length >= 50 && pts.length <= 80, `got ${pts.length}`);
	});
	it("fades from 60 % at the centre toward the edge", () => {
		assert.equal(pointAlpha(0, 0, 0, 0, 10), 0.6);
		assert.ok(pointAlpha(10, 0, 0, 0, 10) < 0.25);
	});
});

describe("Gesture meters", () => {
	it("one bar per gesture in the spec order, with a threshold marker", () => {
		assert.deepEqual(METERS.map((m) => m.id), ["leftWink", "rightWink", "blink", "mouth", "brow", "sleep"]);
		const lv = meterLevels(g({ leftEye: { ratio: 0.05 } }));
		assert.ok(lv.leftWink.level > lv.leftWink.threshold);
		assert.ok(lv.rightWink.level < lv.rightWink.threshold);
		assert.ok(lv.blink.level < lv.blink.threshold, "one closed eye is not a blink");
		assert.equal(meterLevels(null).mouth, null);
	});
});

describe("Gesture help card", () => {
	it("defaults: winks click, three blinks pause, F9 for a helper", () => {
		const groups = gestureRows(settings({}));
		const text = JSON.stringify(groups);
		assert.match(text, /Left click/);
		assert.match(text, /Three quick blinks/);
		assert.match(text, /F9/);
		assert.doesNotMatch(text, /Hold the cursor still/);
	});
	it("follows the settings", () => {
		const text = JSON.stringify(gestureRows(settings({ clickWink: false, clickDwell: true, dwellTime: 1400, pauseMethod: "closeEyes", eyebrowRaiseOpensKeyboard: false })));
		assert.doesNotMatch(text, /Left click/);
		assert.match(text, /still for 1\.4 s/);
		assert.match(text, /Close your eyes for 2 s/);
		assert.doesNotMatch(text, /Keyboard/);
	});
});

describe("Diagnostics numbers", () => {
	it("light level bands", () => {
		assert.equal(lightLevel(30), "Low");
		assert.equal(lightLevel(80), "OK");
		assert.equal(lightLevel(150), "Good");
		assert.equal(lightLevel(undefined), null);
	});
	it("diag stream wins over engine state; confidence as a percentage", () => {
		const d = readDiagnostics({ fps: 30, framing: { brightness: 120 }, confidence: 0.8 }, { fps: 58, light: 40 });
		assert.equal(d.fps, 58);
		assert.equal(d.lightLevel, "Low");
		assert.equal(d.confidence, 80);
	});
	it("click method names from the new keys", () => {
		assert.equal(clickMethodNames(settings({ clickWink: true, clickBlink: false, clickMouth: false, clickDwell: true })), "Wink, Dwell");
		assert.equal(clickMethodNames(settings({})), null);
	});
});

describe("First run: try clicking", () => {
	it("a wink is not a blink, and a blink is not a wink", () => {
		assert.equal(gestureSeen("wink", g({ leftEye: { ratio: 0.05 } })), true);
		assert.equal(gestureSeen("blink", g({ leftEye: { ratio: 0.05 } })), false);
		assert.equal(gestureSeen("wink", g({ leftEye: { ratio: 0.05 }, rightEye: { ratio: 0.05 } })), false);
		assert.equal(gestureSeen("mouth", g({ mouth: { ratio: 0.4 } })), true);
	});
	it("a natural blink (about 120 ms) does not count as a blink click", () => {
		const both = g({ leftEye: { ratio: 0.05 }, rightEye: { ratio: 0.05 } });
		const quick = createTryDetector("blink");
		assert.equal(quick(both, 0) || quick(both, 120) || quick(g(), 160), false);
		const held = createTryDetector("blink");
		held(both, 0);
		assert.equal(held(both, 300), true);
	});
	it("choosing nothing keeps Wink on", () => {
		assert.deepEqual(chooseMethods({}), { clickWink: true, clickBlink: false, clickMouth: false, clickDwell: false });
		assert.deepEqual(chooseMethods({ dwell: true }), { clickWink: false, clickBlink: false, clickMouth: false, clickDwell: true });
	});
});
