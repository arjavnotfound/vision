// Adaptive control mapping (pure, unit tested).
//
// Calibration asks the person to try each gesture. From the measurements we decide which
// gestures are reliable FOR THIS PERSON and route each action to an input that works:
//   - a gesture is unreliable when it is weak (does not clear the threshold suggestion)
//     or not clean (a "right wink" that also closes the left eye fires both);
//   - right click: right wink -> raised brows -> the spoken words "right click";
//   - left click: left wink, or Dwell click mode when the left wink is unreliable;
//   - scroll: mouth + head tilt, or the voice.
// The result is stored only through existing settings (clickingMode, mouthTiltScroll,
// eyebrowRaiseOpensKeyboard) plus the `controlMap` entry in the settings file.

import { suggestThresholds } from "./calibration-math.js";

/** How much the OTHER eye may close during a wink, relative to the winking eye. */
export const MAX_CROSSTALK = 0.5;

/**
 * @param {"eye"|"mouth"|"brow"} kind
 * @param {object} m
 * @param {number} m.neutral resting value
 * @param {number} m.peak most extreme value during the gesture
 * @param {number} [m.otherNeutral] eye only: the other eye at rest
 * @param {number} [m.otherPeak] eye only: lowest value of the other eye during the wink
 * @returns {{reliable: boolean, strength: number, reason: string}}
 */
export function assessGesture(kind, { neutral, peak, otherNeutral, otherPeak } = {}) {
	const suggestion = suggestThresholds(kind, neutral, peak);
	if (!suggestion.ok) {
		return { reliable: false, strength: 0, reason: suggestion.reason === "not measured" ? "not measured" : "too weak" };
	}
	const span = kind === "eye" ? neutral - peak : peak - neutral;
	// Strength: span relative to a comfortable, clear gesture of that kind (1 = clear).
	const clear = kind === "eye" ? 0.15 : kind === "mouth" ? 0.35 : 0.08;
	const strength = Math.round(Math.min(1, span / clear) * 100) / 100;
	if (kind === "eye" && Number.isFinite(otherNeutral) && Number.isFinite(otherPeak)) {
		const otherDrop = otherNeutral - otherPeak;
		if (otherDrop > MAX_CROSSTALK * span) {
			return { reliable: false, strength, reason: "both eyes close" };
		}
	}
	return { reliable: true, strength, reason: "clear" };
}

/**
 * @param {{leftWink, rightWink, mouth, brow}} a results of assessGesture (missing = not measured)
 * @returns {{clickingMode: string, leftClick: string, rightClick: string, scroll: string, keyboard: string}}
 */
export function planControls(a) {
	const ok = (name) => Boolean(a?.[name]?.reliable);
	const leftClick = ok("leftWink") ? "leftWink" : "dwell";
	let rightClick = "voice";
	if (leftClick === "leftWink" && ok("rightWink")) {
		rightClick = "rightWink";
	} else if (ok("brow")) {
		rightClick = "brow";
	}
	return {
		clickingMode: leftClick === "leftWink" ? "blink" : "dwell",
		leftClick,
		rightClick,
		scroll: ok("mouth") ? "mouth" : "voice",
		// Raised brows open the keyboard only while they are not a click.
		keyboard: rightClick === "brow" ? "button" : "brow",
	};
}

/** Settings patch for EXISTING engine settings. */
export function controlSettings(plan) {
	return {
		clickingMode: plan.clickingMode,
		mouthTiltScroll: plan.scroll === "mouth",
		eyebrowRaiseOpensKeyboard: plan.keyboard === "brow",
	};
}

export const ACTION_LABELS = {
	leftClick: "Left click",
	rightClick: "Right click",
	scroll: "Scroll",
	keyboard: "Keyboard",
};

export const INPUT_LABELS = {
	leftWink: "Wink left eye",
	rightWink: "Wink right eye",
	dwell: "Rest on a target (dwell)",
	brow: "Raise your eyebrows",
	mouth: "Open mouth + tilt head",
	voice: "Say it",
	button: "Keyboard button",
};

/** What to say for an action that moved to the voice. */
export const VOICE_PHRASES = {
	rightClick: "“right click”",
	scroll: "“scroll down”",
};

/** Rows for the "Your controls" screen. */
export function describePlan(plan) {
	return ["leftClick", "rightClick", "scroll", "keyboard"].map((action) => {
		const input = plan[action];
		let how = INPUT_LABELS[input] ?? input;
		if (input === "voice") how = `Say ${VOICE_PHRASES[action] ?? "it"}`;
		if (action === "keyboard" && input === "brow") how = "Raise your eyebrows for 3 seconds";
		return { action, label: ACTION_LABELS[action], input, how };
	});
}

/**
 * Runtime watcher: a gesture that keeps firing by accident (many clicks in a short time)
 * or never fires. Returns an offer or null. `events`: [{ button, t }] (gesture clicks, ms).
 */
export function detectMisfire({ events, now, trackingSince, plan, burst = 5, windowMs = 8000, quietMs = 240000 }) {
	for (const button of ["left", "right"]) {
		const recent = events.filter((e) => e.button === button && now - e.t <= windowMs);
		if (recent.length >= burst) {
			if (button === "right" && plan?.rightClick === "rightWink") {
				return { kind: "misfire", action: "rightClick", to: "brow" };
			}
			if (button === "left" && plan?.leftClick === "leftWink") {
				return { kind: "misfire", action: "leftClick", to: "dwell" };
			}
		}
	}
	if (plan?.leftClick === "leftWink" && trackingSince && now - trackingSince > quietMs && !events.some((e) => e.button === "left")) {
		return { kind: "never", action: "leftClick", to: "dwell" };
	}
	return null;
}

/** Apply an accepted runtime switch to a plan. */
export function switchPlan(plan, offer) {
	const next = { ...plan };
	if (offer.action === "rightClick") {
		next.rightClick = offer.to;
		next.keyboard = offer.to === "brow" ? "button" : next.keyboard;
	}
	if (offer.action === "leftClick" && offer.to === "dwell") {
		next.leftClick = "dwell";
		next.clickingMode = "dwell";
		if (next.rightClick === "rightWink") next.rightClick = "voice";
	}
	return next;
}

/** Raised brows as a click must be HELD this long, so surprise or talking does not click. */
export const BROW_HOLD_MS = 400;
export const BROW_COOLDOWN_MS = 1000;

/**
 * Brow-click timer (pure). Call step(raised, now) on every engine state update.
 * Returns true exactly once per raise, when the brows have stayed up for BROW_HOLD_MS;
 * the brows must come down (and the cooldown pass) before the next click.
 */
export function createBrowClick({ holdMs = BROW_HOLD_MS, cooldownMs = BROW_COOLDOWN_MS } = {}) {
	let since = null;
	let fired = false;
	let lastClick = -Infinity;
	return {
		step(raised, now) {
			if (!raised) {
				since = null;
				fired = false;
				return false;
			}
			since ??= now;
			if (!fired && now - since >= holdMs && now - lastClick >= cooldownMs) {
				fired = true;
				lastClick = now;
				return true;
			}
			return false;
		},
		reset() {
			since = null;
			fired = false;
		},
	};
}
/** Inputs the person may pick by hand for each action (manual override of the plan). */
export const INPUT_CHOICES = {
	leftClick: ["leftWink", "dwell"],
	rightClick: ["rightWink", "brow", "voice"],
	scroll: ["mouth", "voice"],
};

export const DEFAULT_PLAN = Object.freeze({ clickingMode: "blink", leftClick: "leftWink", rightClick: "rightWink", scroll: "mouth", keyboard: "brow" });

/**
 * The person's own choice: put `action` on `input`, then keep the plan consistent.
 * - left click on dwell turns on Dwell click mode, so winks stop clicking: a right
 *   wink cannot stay right click (it moves to the voice);
 * - choosing a wink for either click turns Wink mode back on (both winks work there);
 * - raised brows open the keyboard only while they are not right click.
 */
export function choosePlan(plan, action, input) {
	if (!INPUT_CHOICES[action]?.includes(input)) {
		throw new Error(`${input} cannot do ${action}`);
	}
	const next = { ...DEFAULT_PLAN, ...(plan ?? {}), [action]: input };
	if (action === "rightClick" && input === "rightWink") next.leftClick = "leftWink";
	if (action === "leftClick" && input === "dwell" && next.rightClick === "rightWink") next.rightClick = "voice";
	next.clickingMode = next.leftClick === "dwell" ? "dwell" : "blink";
	next.keyboard = next.rightClick === "brow" ? "button" : "brow";
	return next;
}