// Pins the extracted engine modules to the original inline code (tests/fixtures/legacy-engine.cjs)
// on thousands of randomised inputs, including multi-frame sequences that exercise hysteresis.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
	OneEuroFilter, getAspectMetrics, signedDistancePointLine,
	detectBlinks, detectMouthOpen, detectForeheadRaised, DEFAULT_THRESHOLDS,
	stepEyebrowHold, stepSleepHold, resolveClickButton, mouthScrollDirection,
	computeHeadTilt, createHeadTiltSmoother, computeCursorDelta, gestureBindings,
} from "../core/src/index.js";

const require = createRequire(import.meta.url);
const legacy = require("./fixtures/legacy-engine.cjs");
const LegacyLib = require("../core/lib/OneEuroFilter.js");

function rng(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

// A synthetic almond shape: lower contour (with corners) and upper contour, with a given opening.
function contour(random, cx, cy, width, opening, angle, upperCount = 7, lowerCount = 9) {
	const rot = ([x, y]) => [cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle)];
	const lower = [];
	for (let i = 0; i < lowerCount; i++) {
		const t = i / (lowerCount - 1);
		const x = (t - 0.5) * width;
		const y = Math.sin(t * Math.PI) * opening * 0.4 + (random() - 0.5) * 0.4;
		lower.push(rot([x, y]));
	}
	const upper = [];
	for (let i = 0; i < upperCount; i++) {
		const t = (i + 1) / (upperCount + 1);
		const x = (t - 0.5) * width;
		const y = -Math.sin(t * Math.PI) * opening * 0.6 + (random() - 0.5) * 0.4;
		upper.push(rot([x, y]));
	}
	return { upper, lower };
}

function randomFace(random, { eyeOpenL, eyeOpenR, mouthOpen, browLift }) {
	const angle = (random() - 0.5) * 0.4;
	const eyeWidth = 25 + random() * 15;
	const left = contour(random, 360, 200, eyeWidth, eyeOpenL * eyeWidth, angle);
	const right = contour(random, 280, 200, eyeWidth, eyeOpenR * eyeWidth, angle);
	const lips = contour(random, 320, 300, 60, mouthOpen * 60, angle, 11, 11);
	const browY = 200 - (eyeWidth * (0.6 + browLift));
	const brow = (cx) => Array.from({ length: 8 }, (_, i) => [cx - 20 + i * 6, browY + (random() - 0.5) * 2]);
	return {
		leftEyeUpper0: left.upper, leftEyeLower0: left.lower,
		rightEyeUpper0: right.upper, rightEyeLower0: right.lower,
		lipsUpperInner: lips.upper, lipsLowerInner: lips.lower,
		leftEyebrowUpper: brow(360), rightEyebrowUpper: brow(280),
	};
}

// Strip contour references (identity differs between runs) to compare values only.
const values = (obj) => JSON.parse(JSON.stringify(obj));

describe("One Euro filter (pinned to the bundled library)", () => {
	it("matches core/lib/OneEuroFilter.js exactly with the head-tilt parameters", () => {
		const random = rng(7);
		const ours = new OneEuroFilter(60, 0.01, 5.0, 0.7);
		const theirs = new LegacyLib.OneEuroFilter(60, 0.01, 5.0, 0.7);
		let t = 1000;
		for (let i = 0; i < 2000; i++) {
			t += 0.01 + random() * 0.03;
			const value = Math.sin(i / 30) * 0.5 + (random() - 0.5) * 0.1;
			assert.equal(ours.filter(value, t), theirs.filter(value, t));
		}
	});

	it("matches without timestamps and after reset", () => {
		const ours = new OneEuroFilter(30, 1, 0.1, 1);
		const theirs = new LegacyLib.OneEuroFilter(30, 1, 0.1, 1);
		for (let i = 0; i < 100; i++) {
			if (i === 50) { ours.reset(); theirs.reset(); }
			assert.equal(ours.filter(i * 0.37 % 5), theirs.filter(i * 0.37 % 5));
		}
	});
});

describe("Gesture geometry and detectors (pinned to the original inline code)", () => {
	it("signedDistancePointLine and getAspectMetrics are identical", () => {
		const random = rng(1);
		for (let i = 0; i < 500; i++) {
			const p = [random() * 640, random() * 480], a = [random() * 640, random() * 480], b = [random() * 640, random() * 480];
			assert.equal(signedDistancePointLine(p, a, b), legacy.signedDistancePointLine(p, a, b));
			const c = contour(random, 300, 200, 30, random() * 15, random());
			assert.deepEqual(values(getAspectMetrics(c.upper, c.lower)), values(legacy.getAspectMetrics(c.upper, c.lower)));
		}
	});

	it("blink/wink, mouth and brow detection match over random multi-frame sequences", () => {
		const random = rng(99);
		for (let seq = 0; seq < 120; seq++) {
			let prevNewBlink = null, prevOldBlink = null;
			let prevNewMouth = null, prevOldMouth = null;
			let prevNewBrow = null, prevOldBrow = null;
			let time = 1000;
			for (let frame = 0; frame < 40; frame++) {
				time += 10 + random() * 40;
				// Openings around the thresholds so hysteresis matters.
				const face = randomFace(random, {
					eyeOpenL: 0.1 + random() * 0.18,
					eyeOpenR: 0.1 + random() * 0.18,
					mouthOpen: 0.08 + random() * 0.25,
					browLift: random() * 0.5,
				});
				const newBlink = detectBlinks(face, prevNewBlink, time);
				const oldBlink = legacy.detectBlinks(face, prevOldBlink, time);
				assert.deepEqual(values(newBlink), values(oldBlink));
				const newMouth = detectMouthOpen(face, prevNewMouth);
				const oldMouth = legacy.detectMouthOpen(face, prevOldMouth);
				assert.deepEqual(values(newMouth), values(oldMouth));
				const newBrow = detectForeheadRaised(face, prevNewBrow);
				const oldBrow = legacy.detectForeheadRaised(face, prevOldBrow);
				assert.deepEqual(newBrow, oldBrow);
				prevNewBlink = newBlink; prevOldBlink = oldBlink;
				prevNewMouth = newMouth; prevOldMouth = oldMouth;
				prevNewBrow = newBrow; prevOldBrow = oldBrow;
			}
		}
	});

	it("default thresholds are the original constants", () => {
		assert.deepEqual(values(DEFAULT_THRESHOLDS), {
			eye: { high: 0.2, low: 0.16 },
			mouth: { high: 0.25, low: 0.15 },
			brow: { high: 0.28, low: 0.24 },
		});
	});

	it("a deliberate wink activates only after the 100 ms involuntary-blink window", () => {
		const open = (random) => randomFace(random, { eyeOpenL: 0.3, eyeOpenR: 0.3, mouthOpen: 0.05, browLift: 0 });
		const winkLeft = (random) => randomFace(random, { eyeOpenL: 0.02, eyeOpenR: 0.3, mouthOpen: 0.05, browLift: 0 });
		const random = rng(5);
		let info = detectBlinks(open(random), null, 0);
		info = detectBlinks(winkLeft(random), info, 16);
		assert.equal(info.leftEye.active, false, "a 0 ms closure is treated as a possible blink");
		info = detectBlinks(winkLeft(random), info, 80);
		assert.equal(info.leftEye.active, false);
		info = detectBlinks(winkLeft(random), info, 130);
		assert.equal(info.leftEye.active, true);
		assert.equal(info.rightEye.active, false);
	});
});

describe("Hold gestures, scroll and click arbitration (pinned)", () => {
	it("eyebrow (keyboard) hold matches", () => {
		const random = rng(3);
		let a = { progress: 0, cooldownUntil: 0 };
		let b = { eyebrowGestureProgress: 0, eyebrowGestureCooldownUntil: 0 };
		let now = 0;
		for (let i = 0; i < 3000; i++) {
			const dt = Math.min(5 + random() * 60, 200);
			now += dt;
			const raised = random() < 0.8;
			const allowed = random() < 0.95;
			const r = stepEyebrowHold({ ...a, raised, allowed, now, dt });
			const l = legacy.stepEyebrow(b, { thresholdMet: raised, allowed, now, gestureDt: dt });
			assert.equal(r.progress, l.eyebrowGestureProgress);
			assert.equal(r.cooldownUntil, l.eyebrowGestureCooldownUntil);
			assert.equal(r.completed, l.opened);
			a = r;
			b = l;
		}
	});

	it("sleep (eyes closed) hold matches", () => {
		const random = rng(4);
		let p1 = 0, p2 = 0;
		for (let i = 0; i < 3000; i++) {
			const dt = random() * 100;
			const bothClosed = random() < 0.7;
			const r = stepSleepHold({ progress: p1, bothClosed, dt });
			const l = legacy.stepSleep(p2, { bothClosed, deltaTime: dt });
			assert.equal(r.progress, l.sleepGestureProgress);
			assert.equal(r.completed, l.completed);
			p1 = r.progress; p2 = l.sleepGestureProgress;
		}
	});

	it("mouth tilt scroll direction matches", () => {
		const random = rng(8);
		for (let i = 0; i < 2000; i++) {
			const mouthInfo = { thresholdMet: random() < 0.7 };
			const headTilt = { pitch: (random() - 0.5) * 0.6 };
			const s = { headTiltPitchOffset: random() < 0.3 ? 0 : (random() - 0.5) * 0.2 };
			const l = legacy.mouthScroll(mouthInfo, headTilt, s);
			assert.equal(mouthScrollDirection(mouthInfo.thresholdMet, headTilt, s.headTiltPitchOffset), l.mouthScrollDirection);
		}
	});

	it("click arbitration matches for every clicking mode, including its mutations", () => {
		const random = rng(11);
		const modes = ["blink", "open-mouth-simple", "open-mouth", "dwell", "open-mouth-ignoring-eyes", "off"];
		for (const mode of modes) {
			let latchNew = -1, latchOld = -1;
			let prevMouth = false;
			for (let i = 0; i < 500; i++) {
				const eye = () => ({ open: random() < 0.6, active: random() < 0.3 });
				const blink = { leftEye: eye(), rightEye: eye() };
				const mouth = { thresholdMet: random() < 0.5, active: random() < 0.5 };
				const scrolling = random() < 0.2;
				const blinkA = structuredClone(blink), mouthA = structuredClone(mouth);
				const blinkB = structuredClone(blink), mouthB = structuredClone(mouth);
				const r = resolveClickButton({ clickingMode: mode, blinkInfo: blinkA, mouthInfo: mouthA, prevMouthOpen: prevMouth, isMouthScrolling: scrolling, mouseButtonUntilMouthCloses: latchNew });
				const l = legacy.arbitrate({ s: { clickingMode: mode }, blinkInfo: blinkB, mouthInfo: mouthB, prevMouthOpen: prevMouth, isMouthScrolling: scrolling, mouseButtonUntilMouthCloses: latchOld });
				assert.deepEqual(r, l);
				assert.deepEqual(blinkA, blinkB);
				assert.deepEqual(mouthA, mouthB);
				latchNew = r.mouseButtonUntilMouthCloses;
				latchOld = l.mouseButtonUntilMouthCloses;
				prevMouth = mouth.thresholdMet;
			}
		}
	});

	it("gesture bindings describe what arbitration actually does", () => {
		assert.equal(gestureBindings({ clickingMode: "blink" }).leftWink, "LEFT CLICK");
		assert.equal(gestureBindings({ clickingMode: "blink" }).rightWink, "RIGHT CLICK");
		assert.equal(gestureBindings({ clickingMode: "dwell" }).leftWink, "OFF");
		assert.equal(gestureBindings({ clickingMode: "open-mouth-simple", mouthTiltScroll: false }).mouth, "LEFT CLICK");
		assert.equal(gestureBindings({ clickingMode: "blink", closeEyesToToggle: true }).sleep, "PAUSE");
		assert.equal(gestureBindings({ clickingMode: "blink", eyebrowRaiseOpensKeyboard: false }).brow, "OFF");
	});
});

describe("Head pose and cursor motion (pinned)", () => {
	function keypoints(random) {
		const kp = [];
		for (const index of [2, 10, 234, 454]) {
			kp[index] = { x: random() * 640, y: random() * 480, z: (random() - 0.5) * 80 };
		}
		return kp;
	}

	it("pitch/yaw/roll are identical to the original formulas", () => {
		const random = rng(21);
		for (let i = 0; i < 2000; i++) {
			const kp = keypoints(random);
			const ours = computeHeadTilt(kp);
			const theirs = legacy.computeHeadTilt(kp);
			assert.equal(ours.pitch, theirs.pitch);
			assert.equal(ours.yaw, theirs.yaw);
			assert.equal(ours.roll, theirs.roll);
		}
		assert.equal(computeHeadTilt([]), null);
	});

	it("head tilt smoothing equals three library filters with (60, 0.01, 5.0, 0.7)", () => {
		const random = rng(22);
		const smoother = createHeadTiltSmoother();
		const lib = ["pitch", "yaw", "roll"].map(() => new LegacyLib.OneEuroFilter(60, 0.01, 5.0, 0.7));
		let t = 10;
		for (let i = 0; i < 1000; i++) {
			t += 0.016 + random() * 0.02;
			const raw = { pitch: random() - 0.5, yaw: random() - 0.5, roll: random() - 0.5 };
			const out = smoother.filter(raw, t);
			assert.equal(out.pitch, lib[0].filter(raw.pitch, t));
			assert.equal(out.yaw, lib[1].filter(raw.yaw, t));
			assert.equal(out.roll, lib[2].filter(raw.roll, t));
		}
	});

	it("cursor delta (acceleration, tilt influence, threshold, drag delay) is identical", () => {
		const random = rng(33);
		for (let i = 0; i < 5000; i++) {
			const s = {
				headTrackingSensitivityX: random() * 0.1,
				headTrackingSensitivityY: random() * 0.1,
				headTrackingAcceleration: random(),
				headTrackingTiltInfluence: random() < 0.4 ? 0 : random(),
				headTiltYawOffset: (random() - 0.5) * 0.5,
				headTiltPitchOffset: (random() - 0.5) * 0.5,
				headTiltYawRange: 0.2 + random(),
				headTiltPitchRange: 0.2 + random(),
				headTrackingMinDistance: random() < 0.5 ? 0 : random() * 10,
				delayBeforeDragging: random() * 1000,
			};
			const args = {
				movementX: (random() - 0.5) * 10,
				movementY: (random() - 0.5) * 10,
				s,
				headTilt: { yaw: (random() - 0.5) * 0.8, pitch: (random() - 0.5) * 0.8 },
				mouseX: random() * 1920,
				mouseY: random() * 1080,
				screenWidth: 1920,
				screenHeight: 1080,
				timeSinceMouseDown: random() < 0.2 ? random() * 1000 : Infinity,
			};
			assert.deepEqual(computeCursorDelta(args), legacy.cursorDelta(args));
		}
	});
});
