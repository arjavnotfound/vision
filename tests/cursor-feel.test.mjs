import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { jitterPx, lagMs, measure, isClearWin } from "../core/src/filters/feel-metrics.js";
import { HEAD_TILT_FILTER } from "../core/src/pose/head-tilt.js";

const fast = { freq: 60, mincutoff: 5, beta: 0, dcutoff: 1 };
const slow = { freq: 60, mincutoff: 0.5, beta: 0, dcutoff: 1 };

describe("cursor-feel harness", () => {
	it("measures no jitter without noise and more jitter with more noise", () => {
		assert.equal(jitterPx(fast, 0), 0);
		assert.ok(jitterPx(fast, 1) > jitterPx(fast, 0.2));
	});

	it("ranks a heavier filter as steadier but slower", () => {
		assert.ok(jitterPx(slow, 0.5) < jitterPx(fast, 0.5));
		assert.ok(lagMs(slow) > lagMs(fast));
		assert.ok(lagMs(fast) < 200);
	});

	it("needs a margin on every jitter and lag case to call a win", () => {
		const base = { jitter: [1, 2], lag: [100, 200] };
		assert.equal(isClearWin({ jitter: [0.8, 1.6], lag: [80, 160] }, base), true);
		assert.equal(isClearWin({ jitter: [0.8, 1.6], lag: [80, 190] }, base), false);
		assert.equal(isClearWin({ jitter: [0.95, 1.6], lag: [80, 160] }, base), false);
	});

	it("measures the shipped head-tilt filter with finite large-move lag", () => {
		const m = measure(HEAD_TILT_FILTER);
		assert.ok(m.jitter.every(Number.isFinite));
		assert.ok(m.lag[1] < 300, `10 deg step lag ${m.lag[1]} ms`);
	});
});
