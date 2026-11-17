import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	median, percentile, summarizeCenter, summarizeRange, poseSettings,
	suggestSensitivityFactor, suggestThresholds, combineEyeSuggestions, thresholdSettings,
} from "../app/src/ui/js/calibration-math.js";
import { detectBlinks, DEFAULT_THRESHOLDS } from "../core/src/gestures/detect.js";

const deg = (rad) => rad * 180 / Math.PI;

describe("Calibration math", () => {
	it("median / percentile ignore non-finite samples", () => {
		assert.equal(median([3, NaN, 1, 2]), 2);
		assert.equal(median([]), NaN);
		assert.equal(percentile([1, 2, 3, 4, 100], 0.5), 3);
	});

	it("centre and range summaries reject outliers", () => {
		const samples = Array.from({ length: 100 }, (_, i) => ({ yaw: (i % 50) - 25, pitch: (i % 20) - 10 }));
		samples.push({ yaw: 200, pitch: 200 }); // one wild frame
		const range = summarizeRange(samples);
		assert.ok(range.yawMax <= 25 && range.yawMin >= -25);
		assert.ok(range.pitchMax <= 10);
		const center = summarizeCenter([{ yaw: 1, pitch: 2, leftEye: 0.3 }, { yaw: 3, pitch: 4, leftEye: 0.28 }, { yaw: 2, pitch: 3, leftEye: 0.29 }]);
		assert.equal(center.yaw, 2);
		assert.equal(center.leftEye, 0.29);
	});

	it("maps the measured pose onto the existing head-tilt settings, clamped to the slider ranges", () => {
		const out = poseSettings({ yaw: 5, pitch: -3 }, { yawMin: -30, yawMax: 30, pitchMin: -12, pitchMax: 16 });
		assert.ok(Math.abs(deg(out.headTiltYawOffset) - 5) < 1e-9);
		assert.ok(Math.abs(deg(out.headTiltPitchOffset) + 3) < 1e-9);
		assert.ok(Math.abs(deg(out.headTiltYawRange) - 51) < 1e-9); // 60 * 0.85
		assert.ok(Math.abs(deg(out.headTiltPitchRange) - 23.8) < 1e-9); // 28 * 0.85
		const extreme = poseSettings({ yaw: 80, pitch: -50 }, { yawMin: -200, yawMax: 200, pitchMin: -1, pitchMax: 1 });
		assert.ok(Math.abs(deg(extreme.headTiltYawOffset) - 45) < 1e-9);
		assert.ok(Math.abs(deg(extreme.headTiltPitchOffset) + 30) < 1e-9);
		assert.ok(Math.abs(deg(extreme.headTiltYawRange) - 90) < 1e-9);
		assert.equal(extreme.headTiltPitchRange, undefined, "a tiny span is not trusted");
	});

	it("sensitivity suggestion is bounded", () => {
		assert.equal(suggestSensitivityFactor({ yawMin: -30, yawMax: 30 }), 1);
		assert.equal(suggestSensitivityFactor({ yawMin: -5, yawMax: 5 }), 1.6);
		assert.equal(suggestSensitivityFactor({ yawMin: -90, yawMax: 90 }), 0.7);
		assert.equal(suggestSensitivityFactor({ yawMin: NaN, yawMax: 3 }), 1);
	});

	it("eye thresholds sit between the closed peak and the open rest value (low < high)", () => {
		const s = suggestThresholds("eye", 0.3, 0.08);
		assert.equal(s.ok, true);
		assert.ok(s.low > 0.08 && s.low < s.high && s.high < 0.3);
		assert.equal(suggestThresholds("eye", 0.3, 0.27).ok, false, "unclear wink is rejected");
	});

	it("suggested eye thresholds still detect the measured wink and ignore the open eye", () => {
		const neutral = 0.3;
		const closed = 0.08;
		const s = suggestThresholds("eye", neutral, closed);
		// With the suggested thresholds, an eye at `closed` is closed and at `neutral` is open.
		const contour = (opening) => {
			const lower = [];
			const upper = [];
			for (let i = 0; i < 9; i++) lower.push([i * 5, Math.sin(i / 8 * Math.PI) * opening * 40 * 0.35]);
			for (let i = 0; i < 7; i++) upper.push([(i + 1) * 5, -Math.sin((i + 1) / 8 * Math.PI) * opening * 40 * 0.65]);
			return { upper, lower };
		};
		const face = (l, r) => ({ leftEyeUpper0: contour(l).upper, leftEyeLower0: contour(l).lower, rightEyeUpper0: contour(r).upper, rightEyeLower0: contour(r).lower });
		let info = detectBlinks(face(neutral, neutral), null, 0, s);
		assert.equal(info.leftEye.open, true);
		info = detectBlinks(face(closed, neutral), info, 50, s);
		info = detectBlinks(face(closed, neutral), info, 200, s);
		assert.equal(info.leftEye.open, false);
		assert.equal(info.leftEye.active, true);
	});

	it("mouth and brow suggestions, and combining both winks", () => {
		const mouth = suggestThresholds("mouth", 0.05, 0.55);
		assert.ok(mouth.ok && mouth.low < mouth.high && mouth.high < 0.55 && mouth.low > 0.05);
		assert.equal(suggestThresholds("mouth", 0.05, 0.1).ok, false);
		const brow = suggestThresholds("brow", 0.22, 0.32);
		assert.ok(brow.ok && brow.low < brow.high);
		const eye = combineEyeSuggestions(suggestThresholds("eye", 0.3, 0.08), suggestThresholds("eye", 0.28, 0.12));
		assert.ok(eye.ok && eye.high >= eye.low + 0.02);
		assert.equal(combineEyeSuggestions({ ok: false, reason: "x" }, undefined).ok, false);
	});

	it("only clearly measured gestures change settings", () => {
		const patch = thresholdSettings({ eye: { ok: true, high: 0.22, low: 0.18 }, mouth: { ok: false }, brow: { ok: true, high: 0.3, low: 0.26 } });
		assert.deepEqual(patch, { eyeThresholdHigh: 0.22, eyeThresholdLow: 0.18, browThresholdHigh: 0.3, browThresholdLow: 0.26 });
		assert.ok(DEFAULT_THRESHOLDS.mouth.high === 0.25, "defaults untouched");
	});
});

import { createRangeTracker, extents, rangeDegrees, rangeSentence } from "../app/src/ui/js/calibration-math.js";

describe("Calibration range step", () => {
	const center = { yaw: 2, pitch: 3 };
	it("extents are degrees from centre, left = positive engine yaw", () => {
		assert.deepEqual(extents(center, { yaw: 12, pitch: 0 }), { left: 10, right: 0, up: 0, down: 3 });
	});
	it("locks a direction only after holding its best for 0.5 s", () => {
		const tr = createRangeTracker(center);
		let t = 0;
		for (let i = 0; i < 5; i++) tr.push({ yaw: 26, pitch: 3 }, t += 33);
		assert.equal(tr.state().left.locked, false);
		for (let i = 0; i < 16; i++) tr.push({ yaw: 26, pitch: 3 }, t += 33);
		const s = tr.state().left;
		assert.equal(s.locked, true);
		assert.equal(Math.round(s.best), 24);
		assert.equal(tr.allLocked(), false);
	});
	it("one jerky frame does not set the best", () => {
		const tr = createRangeTracker(center);
		let t = 0;
		for (const yaw of [2, 2, 60, 2, 2]) tr.push({ yaw, pitch: 3 }, t += 33);
		assert.ok(tr.state().left.best < 1);
	});
	it("a small turn below the minimum never locks", () => {
		const tr = createRangeTracker(center);
		for (let t = 0; t < 2000; t += 33) tr.push({ yaw: 5, pitch: 3 }, t);
		assert.equal(tr.state().left.locked, false);
	});
	it("range and sentence from the tracker", () => {
		const tr = createRangeTracker(center);
		let t = 0;
		for (const pose of [{ yaw: 26, pitch: 3 }, { yaw: -25, pitch: 3 }, { yaw: 2, pitch: 15 }, { yaw: 2, pitch: -12 }]) {
			for (let i = 0; i < 25; i++) tr.push(pose, t += 33);
		}
		assert.equal(tr.allLocked(), true);
		const deg = rangeDegrees(center, tr.range());
		assert.deepEqual(deg, { left: 24, right: 27, up: 12, down: 15 });
		assert.equal(rangeSentence(deg), "Your range: left 24°, right 27°, up 12°, down 15°. The cursor will reach every edge.");
		assert.match(rangeSentence({ ...deg, up: 2, down: 1 }), /further up and down would help/);
	});
});
