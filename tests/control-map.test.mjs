import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessGesture, planControls, controlSettings, describePlan, detectMisfire, switchPlan, createBrowClick, BROW_HOLD_MS, choosePlan, DEFAULT_PLAN } from "../app/src/ui/js/control-map.js";

// Typical resting ratios: eyes ~0.30, mouth ~0.05, brow ~0.22.
const clearWink = { neutral: 0.3, peak: 0.12, otherNeutral: 0.3, otherPeak: 0.27 };
const bothEyes = { neutral: 0.3, peak: 0.12, otherNeutral: 0.3, otherPeak: 0.14 };
const weakWink = { neutral: 0.3, peak: 0.27 };
const goodMouth = { neutral: 0.05, peak: 0.5 };
const goodBrow = { neutral: 0.22, peak: 0.32 };
const weakBrow = { neutral: 0.22, peak: 0.23 };

describe("adaptive control map", () => {
	it("rates a clear wink reliable, a weak one or a both-eyes one unreliable", () => {
		assert.equal(assessGesture("eye", clearWink).reliable, true);
		assert.deepEqual(assessGesture("eye", weakWink), { reliable: false, strength: 0, reason: "too weak" });
		assert.equal(assessGesture("eye", bothEyes).reason, "both eyes close");
		assert.equal(assessGesture("eye", {}).reason, "not measured");
	});

	it("keeps the default wink mapping when every gesture works", () => {
		const plan = planControls({
			leftWink: assessGesture("eye", clearWink), rightWink: assessGesture("eye", clearWink),
			mouth: assessGesture("mouth", goodMouth), brow: assessGesture("brow", goodBrow),
		});
		assert.deepEqual(plan, { clickingMode: "blink", leftClick: "leftWink", rightClick: "rightWink", scroll: "mouth", keyboard: "brow" });
		assert.deepEqual(controlSettings(plan), { clickingMode: "blink", mouthTiltScroll: true, eyebrowRaiseOpensKeyboard: true });
	});

	it("moves right click to raised brows when the right wink closes both eyes", () => {
		const plan = planControls({
			leftWink: assessGesture("eye", clearWink), rightWink: assessGesture("eye", bothEyes),
			mouth: assessGesture("mouth", goodMouth), brow: assessGesture("brow", goodBrow),
		});
		assert.equal(plan.rightClick, "brow");
		assert.equal(plan.keyboard, "button");
		assert.equal(controlSettings(plan).eyebrowRaiseOpensKeyboard, false);
	});

	it("moves right click to the voice when brows are weak too", () => {
		const plan = planControls({
			leftWink: assessGesture("eye", clearWink), rightWink: assessGesture("eye", weakWink),
			brow: assessGesture("brow", weakBrow), mouth: assessGesture("mouth", goodMouth),
		});
		assert.equal(plan.rightClick, "voice");
		assert.match(describePlan(plan).find((r) => r.action === "rightClick").how, /right click/);
	});

	it("switches to Dwell click mode when no wink works", () => {
		const plan = planControls({ leftWink: assessGesture("eye", weakWink), rightWink: assessGesture("eye", weakWink) });
		assert.equal(plan.clickingMode, "dwell");
		assert.equal(plan.leftClick, "dwell");
		assert.equal(plan.rightClick, "voice");
		assert.equal(plan.scroll, "voice");
		assert.equal(controlSettings(plan).mouthTiltScroll, false);
	});

	it("offers to switch a gesture that keeps firing, or never fires", () => {
		const plan = planControls({ leftWink: { reliable: true }, rightWink: { reliable: true } });
		const burst = Array.from({ length: 5 }, (_, i) => ({ button: "right", t: 1000 + i * 500 }));
		assert.deepEqual(detectMisfire({ events: burst, now: 4000, plan }), { kind: "misfire", action: "rightClick", to: "brow" });
		assert.equal(detectMisfire({ events: burst.slice(0, 3), now: 4000, plan }), null);
		assert.deepEqual(detectMisfire({ events: [], now: 300000, trackingSince: 1, plan }), { kind: "never", action: "leftClick", to: "dwell" });
		const next = switchPlan(plan, { action: "leftClick", to: "dwell" });
		assert.equal(next.clickingMode, "dwell");
		assert.equal(next.rightClick, "voice");
	});
});

describe("brow click needs a 0.4 s hold", () => {
	it("a quick brow flash (surprise, talking) never clicks", () => {
		const brow = createBrowClick();
		assert.equal(BROW_HOLD_MS, 400);
		let clicks = 0;
		for (let t = 0; t <= 350; t += 50) clicks += brow.step(true, t) ? 1 : 0;
		clicks += brow.step(false, 400) ? 1 : 0;
		assert.equal(clicks, 0);
	});

	it("held 0.4 s clicks exactly once; must come down before the next", () => {
		const brow = createBrowClick();
		const fired = [];
		for (let t = 0; t <= 2000; t += 50) if (brow.step(true, t)) fired.push(t);
		assert.deepEqual(fired, [400]);
		assert.equal(brow.step(false, 2050), false);
		const again = [];
		for (let t = 2100; t <= 2600; t += 50) if (brow.step(true, t)) again.push(t);
		assert.deepEqual(again, [2500]);
	});

	it("respects the cooldown between clicks", () => {
		const brow = createBrowClick();
		for (let t = 0; t <= 400; t += 50) brow.step(true, t);
		brow.step(false, 450);
		const fired = [];
		for (let t = 500; t <= 1600; t += 50) if (brow.step(true, t)) fired.push(t);
		assert.deepEqual(fired, [1400], "next click no sooner than 1 s after the first");
	});
});
describe("the person can change their controls by hand", () => {
	const brows = { ...DEFAULT_PLAN, rightClick: "brow", keyboard: "button" };

	it("calibration picked brows for right click; the person moves it back to the right wink", () => {
		const next = choosePlan(brows, "rightClick", "rightWink");
		assert.deepEqual(next, DEFAULT_PLAN);
		assert.equal(controlSettings(next).eyebrowRaiseOpensKeyboard, true);
	});

	it("right click can go to brows or the voice", () => {
		assert.equal(choosePlan(DEFAULT_PLAN, "rightClick", "brow").keyboard, "button");
		assert.equal(choosePlan(DEFAULT_PLAN, "rightClick", "voice").rightClick, "voice");
	});

	it("dwell for left click turns winks off, so a right wink moves to the voice", () => {
		const next = choosePlan(DEFAULT_PLAN, "leftClick", "dwell");
		assert.equal(next.clickingMode, "dwell");
		assert.equal(next.rightClick, "voice");
		assert.equal(choosePlan(brows, "leftClick", "dwell").rightClick, "brow", "brows still work in dwell mode");
	});

	it("choosing a right wink while in dwell mode brings winks back for both clicks", () => {
		const dwell = choosePlan(DEFAULT_PLAN, "leftClick", "dwell");
		const next = choosePlan(dwell, "rightClick", "rightWink");
		assert.equal(next.leftClick, "leftWink");
		assert.equal(next.clickingMode, "blink");
	});

	it("scroll can go to the voice and back; impossible choices are refused", () => {
		assert.equal(controlSettings(choosePlan(DEFAULT_PLAN, "scroll", "voice")).mouthTiltScroll, false);
		assert.throws(() => choosePlan(DEFAULT_PLAN, "leftClick", "brow"), /cannot/);
		assert.throws(() => choosePlan(DEFAULT_PLAN, "scroll", "rightWink"), /cannot/);
	});
});