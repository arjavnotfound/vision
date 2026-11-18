// Low light, tracking confidence, the "where's my cursor" pulse and the in-app dwell gate.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { measureBrightness, createLowLightWatch, trackingConfidence, CONFIDENCE_FLOOR } from "../core/src/index.js";
import { inAppDwellAllowed } from "../app/src/ui/js/dwell.js";

const require = createRequire(import.meta.url);
const { createFaceReturnPulse } = require("../app/src/electron-main/input-gates.js");

function frame(width, height, luma, box = null, boxLuma = luma) {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const inBox = box && x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
			const v = inBox ? boxLuma : luma;
			data.set([v, v, v, 255], (y * width + x) * 4);
		}
	}
	return { data, width, height };
}

describe("Low light", () => {
	it("measures the light on the face box, not the whole frame", () => {
		const box = { x: 40, y: 30, width: 40, height: 40 };
		const img = frame(160, 120, 200, box, 30); // bright room, dark face (backlit)
		assert.ok(Math.abs(measureBrightness(img, 16, box) - 30) < 1);
		assert.ok(measureBrightness(img, 16) > 150);
	});

	it("says it once, after 3 s below the threshold", () => {
		const watch = createLowLightWatch({ threshold: 55, holdMs: 3000 });
		const told = [];
		for (let t = 0; t <= 10000; t += 1000) {
			if (watch.step(t < 2000 ? 100 : 20, t)) told.push(t);
		}
		assert.deepEqual(told, [5000]);
		assert.equal(watch.low, true);
		watch.step(100, 11000);
		assert.equal(watch.low, false);
		for (let t = 12000; t <= 20000; t += 1000) assert.equal(watch.step(20, t), false, "once per session");
	});

	it("a short dip does not count", () => {
		const watch = createLowLightWatch({ threshold: 55, holdMs: 3000 });
		assert.equal([20, 20, 100, 20, 20, 100].some((v, i) => watch.step(v, i * 1000)), false);
	});
});

describe("Tracking confidence", () => {
	it("is zero without a face and holds the cursor below the floor", () => {
		assert.equal(trackingConfidence({ faceFound: false, points: 500 }), 0);
		assert.ok(trackingConfidence({ faceFound: true, points: 0 }) < CONFIDENCE_FLOOR);
		assert.equal(trackingConfidence({ faceFound: true, points: 200 }), 1);
	});
	it("lets the cursor move with the points the tracker really keeps", () => {
		// core/vision.js seeds at most 3 flow points from the face mesh (nostrils, between eyes)
		for (const points of [1, 2, 3]) {
			assert.ok(trackingConfidence({ faceFound: true, points }) >= CONFIDENCE_FLOOR, `${points} points`);
		}
		assert.equal(trackingConfidence({ faceFound: true, points: 3 }), 1);
	});
});

describe("Where's my cursor", () => {
	it("pulses when the face is found again after 2 s or more without it", () => {
		const step = createFaceReturnPulse({ minLostMs: 2000 });
		assert.equal(step(false, 0), false);
		assert.equal(step(true, 100), false);
		assert.equal(step(false, 1500), false, "lost for 1.4 s: no pulse");
		assert.equal(step(true, 2000), false);
		assert.equal(step(true, 3000), false);
		assert.equal(step(false, 4100), true, "lost for 2.1 s");
		assert.equal(step(false, 4200), false, "only once");
	});
});

describe("In-app dwell", () => {
	const get = (settings) => (key) => settings[key];
	it("VISION's own buttons take a dwell with any click method, so nobody is stranded", () => {
		assert.equal(inAppDwellAllowed(get({ clickWink: true, clickDwell: false })), true, "wink only");
		assert.equal(inAppDwellAllowed(get({})), true, "defaults");
		assert.equal(inAppDwellAllowed(get({ clickWink: false, clickBlink: false, clickMouth: false, clickDwell: false })), true);
	});
	it("is off when desktop Dwell is on: the overlay already dwells on this window", () => {
		assert.equal(inAppDwellAllowed(get({ clickWink: false, clickDwell: true })), false);
	});
});
