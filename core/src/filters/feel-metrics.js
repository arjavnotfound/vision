// Cursor-feel metrics: jitter and lag of the head-tilt One Euro filter on
// synthetic head motion (seeded, so runs are reproducible).
// CLI: node scripts/bench/cursor-feel.js. Not exported from index.js (bench only).
// shortcut: synthetic input only, no recorded face; swap in a recorded yaw trace when one exists.

import { OneEuroFilter } from "./one-euro.js";
import { HEAD_TILT_FILTER } from "../pose/head-tilt.js";

const FPS = 60; // measured camera loop rate (scripts/bench/results.jsonl)
const DEG = Math.PI / 180;
// Default tilt mapping: 60 deg yaw spans a 1920 px screen.
export const PX_PER_RAD = 1920 / (60 * DEG);

function rng(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}
function gaussian(random) {
	return Math.sqrt(-2 * Math.log(random() || 1e-12)) * Math.cos(2 * Math.PI * random());
}

function run(params, signal, times) {
	const f = new OneEuroFilter(params.freq, params.mincutoff, params.beta, params.dcutoff);
	return signal.map((v, i) => f.filter(v, times[i]));
}

function frameTimes(n, random) {
	// 60 Hz with +-2 ms scheduling jitter, like requestAnimationFrame timestamps.
	return Array.from({ length: n }, (_, i) => (i / FPS) + (random() - 0.5) * 0.004);
}

/** RMS cursor wobble (px) while the head is held still with landmark noise. */
export function jitterPx(params, noiseDeg, seed = 1) {
	const random = rng(seed);
	const n = FPS * 11;
	const times = frameTimes(n, random);
	const signal = times.map(() => gaussian(random) * noiseDeg * DEG);
	const out = run(params, signal, times).slice(FPS); // skip 1 s settle
	// Wobble about the output's own mean: a constant offset does not look like jitter.
	const mean = out.reduce((a, v) => a + v, 0) / out.length;
	return Math.sqrt(out.reduce((a, v) => a + (v - mean) ** 2, 0) / out.length) * PX_PER_RAD;
}

/** Time (ms) for the output to reach 90% of a clean head step (Infinity past 10 s). */
export function lagMs(params, stepDeg = 10) {
	const random = rng(7);
	const n = FPS * 11;
	const times = frameTimes(n, random);
	const start = FPS; // step after 1 s
	const signal = times.map((_, i) => (i >= start ? stepDeg * DEG : 0));
	const out = run(params, signal, times);
	for (let i = start; i < n; i++) {
		if (out[i] >= 0.9 * stepDeg * DEG) return (times[i] - times[start]) * 1000;
	}
	return Infinity;
}

export const FRAME_HZ = FPS;
export const NOISE_LEVELS_DEG = [0.2, 0.5, 1.0];
export const STEP_SIZES_DEG = [3, 10];

const SEEDS = 20; // one 10 s hold is too noisy to rank slow filters
const meanJitterPx = (params, noiseDeg) => {
	let total = 0;
	for (let seed = 1; seed <= SEEDS; seed++) total += jitterPx(params, noiseDeg, seed);
	return total / SEEDS;
};

export function measure(params) {
	return {
		jitter: NOISE_LEVELS_DEG.map((d) => meanJitterPx(params, d)),
		lag: STEP_SIZES_DEG.map((s) => lagMs(params, s)),
	};
}

/** A clear win: at least 10% better on every jitter and every lag case. */
export function isClearWin(candidate, baseline, margin = 0.1) {
	const better = (c, b) => c <= b * (1 - margin);
	return candidate.jitter.every((v, i) => better(v, baseline.jitter[i]))
		&& candidate.lag.every((v, i) => better(v, baseline.lag[i]));
}

export function gridSearch(baselineParams = HEAD_TILT_FILTER) {
	const baseline = measure(baselineParams);
	const results = [];
	for (const mincutoff of [0.003, 0.005, 0.01, 0.02, 0.05, 0.1, 0.3, 1]) {
		for (const beta of [0.5, 1, 2, 5, 10, 20, 50, 100]) {
			for (const dcutoff of [0.3, 0.7, 1, 2]) {
				const params = { freq: FPS, mincutoff, beta, dcutoff };
				const m = measure(params);
				results.push({ params, ...m, win: isClearWin(m, baseline) });
			}
		}
	}
	return { baseline, results };
}
