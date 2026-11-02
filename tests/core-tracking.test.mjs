import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPruner, legacyPruneIndexes } from "../core/src/tracking/prune.js";
import { createFaceLock, faceBox } from "../core/src/tracking/face-select.js";

// Small deterministic PRNG so failures are reproducible.
function rng(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

function maskFromIndexes(indexes, n) {
	const mask = new Uint8Array(n);
	for (const i of indexes) mask[i] = 1;
	return mask;
}

describe("prunePoints grid de-duplication (behaviour-identical rewrite)", () => {
	it("matches the original string-keyed implementation on random point clouds", () => {
		const random = rng(42);
		const prune = createPruner(5);
		for (let trial = 0; trial < 300; trial++) {
			const n = Math.floor(random() * 400);
			const xy = new Float32Array(n * 2);
			for (let i = 0; i < n * 2; i++) {
				// Mostly in-frame, some negative / clustered / exact-cell-boundary values.
				const r = random();
				xy[i] = r < 0.1 ? -random() * 20 : r < 0.2 ? Math.round(random() * 40) * 5 : 200 + random() * 60;
			}
			const expected = maskFromIndexes(legacyPruneIndexes(xy, n, 5), n);
			const actual = prune(xy, n).slice(0, n);
			assert.deepEqual(actual, expected, `trial ${trial}`);
		}
	});

	it("handles NaN, Infinity and huge coordinates exactly like the original", () => {
		const prune = createPruner(5);
		const xy = new Float32Array([NaN, NaN, 0.4, 0.4, Infinity, -Infinity, 1e9, 3, 1e9, 4, -0.5, 2]);
		const n = xy.length / 2;
		assert.deepEqual(prune(xy, n).slice(0, n), maskFromIndexes(legacyPruneIndexes(xy, n, 5), n));
	});

	it("keeps the last point of each cell (later points win, as before)", () => {
		const prune = createPruner(5);
		const xy = new Float32Array([1, 1, 2, 2, 7, 7, 3, 3]);
		assert.deepEqual([...prune(xy, 4).slice(0, 4)], [0, 0, 1, 1]);
	});

	it("reuses its buffers between frames (no growth for same-sized input)", () => {
		const prune = createPruner(5);
		const a = prune(new Float32Array(200), 100);
		const b = prune(new Float32Array(200), 100);
		assert.equal(a, b);
	});
});

describe("Multi-face selection (face lock)", () => {
	const frame = { width: 640, height: 480 };
	const face = (x, y, w, h = w) => ({ box: { xMin: x, yMin: y, width: w, height: h } });

	it("with one face behaves like predictions[0]", () => {
		const lock = createFaceLock({ getFrameSize: () => frame });
		const only = face(200, 100, 200);
		assert.equal(lock.select([only], 0), only);
		assert.equal(lock.select([], 10), undefined);
	});

	it("initially prefers the largest / most central face, not predictions[0]", () => {
		const lock = createFaceLock({ getFrameSize: () => frame });
		const smallCorner = face(10, 10, 80);
		const bigCentral = face(220, 140, 200);
		assert.equal(lock.select([smallCorner, bigCentral], 0), bigCentral);
	});

	it("keeps following the locked face when a bigger face appears", () => {
		const lock = createFaceLock({ getFrameSize: () => frame });
		const user = face(250, 150, 140);
		assert.equal(lock.select([user], 0), user);
		const userMoved = face(260, 152, 140);
		const bigVisitor = face(20, 40, 260);
		assert.equal(lock.select([bigVisitor, userMoved], 33), userMoved);
	});

	it("does not jump to a stranger while the user is briefly lost, but recovers after lostAfterMs", () => {
		const lock = createFaceLock({ getFrameSize: () => frame, lostAfterMs: 1000 });
		const user = face(250, 150, 140);
		lock.select([user], 0);
		const stranger = face(10, 10, 120);
		assert.equal(lock.select([stranger], 100), undefined, "stranger ignored while lock is fresh");
		assert.equal(lock.select([stranger], 1200), stranger, "lock released after the user is gone for >1s");
	});

	it("derives a box from keypoints when no box is given", () => {
		const box = faceBox({ keypoints: [{ x: 10, y: 20 }, { x: 50, y: 5 }, { x: 30, y: 60 }] });
		assert.deepEqual(box, { x: 10, y: 5, width: 40, height: 55 });
	});

	it("reset() clears the lock", () => {
		const lock = createFaceLock({ getFrameSize: () => frame });
		lock.select([face(250, 150, 140)], 0);
		lock.reset();
		const other = face(10, 10, 120);
		assert.equal(lock.select([other], 10), other);
	});
});
