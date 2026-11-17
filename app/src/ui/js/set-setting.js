// "Vision, slower cursor", "Vision, longer dwell", "Vision, pause": the voice assistant's
// set_setting tool lands here. Only these names are accepted, every value is range-checked,
// and each change goes through the same steppers the Settings view uses.

import { STEPPERS } from "./controls.js";

const stepper = (id) => STEPPERS.find((def) => def.id === id);
const ON = new Set(["on", "true", "yes", "1"]);
const OFF = new Set(["off", "false", "no", "0"]);

function onOff(value) {
	const text = String(value ?? "").trim().toLowerCase();
	if (ON.has(text)) return true;
	if (OFF.has(text)) return false;
	return null;
}

// A relative word moves one step; a number must already be inside the range.
function stepTo(def, current, value, words, toStep = (n) => n) {
	const text = String(value ?? "").trim().toLowerCase();
	if (text in words) return Math.min(def.max, Math.max(def.min, current + words[text]));
	const number = Number(text);
	if (text === "" || !Number.isFinite(number)) return null;
	const step = Math.round(toStep(number));
	return step >= def.min && step <= def.max ? step : null;
}

/**
 * Apply one setting. Returns the bus reply: `{ done, value }` or `{ done: "none", error }`.
 * @param {string} name cursor_speed | dwell_time | paused | face_control
 */
export function applySetting(name, value, { st, engine }) {
	if (name === "cursor_speed") {
		const def = stepper("sensitivity");
		const current = def.get(st);
		const next = stepTo(def, current, value, { faster: 1, slower: -1 });
		if (next === null) return { done: "none", error: "Cursor speed goes from 1 to 10, or say faster or slower." };
		if (next === current) return { done: "none", error: `Cursor speed is already ${current}, the ${current === def.max ? "fastest" : "slowest"}.` };
		def.set(st, next, current);
		return { done: `cursor speed ${next}`, value: next };
	}
	if (name === "dwell_time") {
		const def = stepper("dwellTime");
		const current = def.get(st);
		// Spoken as seconds (1.2) or milliseconds (1200); stored as 100 ms steps.
		const next = stepTo(def, current, value, { longer: 1, shorter: -1 }, (n) => (n < 10 ? n * 10 : n / 100));
		if (next === null) return { done: "none", error: "Dwell time goes from 0.6 to 1.5 seconds." };
		if (next === current) return { done: "none", error: `Dwell time is already ${def.format(current)}, the ${current === def.max ? "longest" : "shortest"}.` };
		def.set(st, next, current);
		return { done: `dwell time ${def.format(next)}`, value: next * 100 };
	}
	if (name === "paused" || name === "face_control") {
		const on = onOff(value);
		if (on === null) return { done: "none", error: "Say on or off." };
		const pause = name === "paused" ? on : !on;
		engine.setPaused(pause);
		return { done: pause ? "paused" : "resumed", value: pause ? "paused" : "resumed" };
	}
	return { done: "none", error: `I can't change ${name} by voice.` };
}
