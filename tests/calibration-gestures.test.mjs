// Calibration's gesture step: thresholds and the adaptive control plan (protected input safety).
import test from "node:test";
import assert from "node:assert/strict";
import { GESTURE_TASKS, gestureDone, gestureResults } from "../app/src/ui/js/calibration.js";

const [leftWink, , mouth] = GESTURE_TASKS;
const center = { leftEye: 0.3, rightEye: 0.3, mouth: 0.05, brow: 0.22 };

test("a gesture is done once it was clear and has been released", () => {
	assert.equal(gestureDone(leftWink, 0.3, 0.12, 0.13), false, "still closed");
	assert.equal(gestureDone(leftWink, 0.3, 0.12, 0.28), true, "reopened");
	assert.equal(gestureDone(leftWink, 0.3, 0.27, 0.3), false, "too small to count");
	assert.equal(gestureDone(mouth, 0.05, 0.5, 0.08), true);
	assert.equal(gestureDone(mouth, 0.05, NaN, 0.08), false);
});

test("clear winks keep wink clicking and set thresholds", () => {
	const r = gestureResults(center, { leftWink: 0.1, rightWink: 0.1, mouth: 0.5, brow: 0.32 }, { leftWink: 0.29, rightWink: 0.29 });
	assert.equal(r.plan.leftClick, "leftWink");
	assert.equal(r.plan.rightClick, "rightWink");
	assert.ok(r.thresholds.eyeThresholdLow > 0 && r.thresholds.mouthThresholdHigh > 0 && r.thresholds.browThresholdHigh > 0);
});

test("no usable wink moves left click to dwell; unmeasured gestures keep thresholds", () => {
	const r = gestureResults(center, { brow: 0.32 }, {});
	assert.equal(r.plan.leftClick, "dwell");
	assert.equal(r.plan.rightClick, "brow");
	assert.equal(r.thresholds.eyeThresholdLow, undefined);
});

test("a wink that closes both eyes is not trusted", () => {
	const r = gestureResults(center, { leftWink: 0.1, rightWink: 0.1 }, { leftWink: 0.1, rightWink: 0.1 });
	assert.equal(r.assessment.leftWink.reliable, false);
	assert.equal(r.plan.leftClick, "dwell");
});
