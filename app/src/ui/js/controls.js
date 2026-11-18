// Speed and dwell time levels shared by Settings and the voice "set setting" command.
// Talks only to engine.settings.

import { clamp } from "./dom.js";

const BASE_SENSITIVITY_X = 0.025; // engine defaults (legacy slider 25 / 1000)
const MAX_SENSITIVITY = 0.1; // legacy slider maximum

/** Sensitivity is shown as a 1–10 level; each step is ×2^(1/3) (about 26%). Level 5 = default. */
export function sensitivityLevel(sensitivityX) {
	return clamp(Math.round(5 + 3 * Math.log2(sensitivityX / BASE_SENSITIVITY_X)), 1, 10);
}

export function scaleSensitivity(settings, fromLevel, toLevel) {
	const factor = 2 ** ((toLevel - fromLevel) / 3);
	const x = clamp(settings.get("headTrackingSensitivityX") * factor, 0.002, MAX_SENSITIVITY);
	const y = clamp(settings.get("headTrackingSensitivityY") * factor, 0.002, MAX_SENSITIVITY);
	settings.set("headTrackingSensitivityX", Math.round(x * 10000) / 10000);
	settings.set("headTrackingSensitivityY", Math.round(y * 10000) / 10000);
}

export const STEPPERS = [
	{
		id: "sensitivity",
		name: "Speed",
		sub: "How far the cursor moves when you turn your head",
		get: (st) => sensitivityLevel(st.get("headTrackingSensitivityX")),
		min: 1,
		max: 10,
		set: (st, level, current) => scaleSensitivity(st, current, level),
		format: (level) => String(level),
	},
	{
		id: "acceleration",
		name: "Acceleration",
		sub: "Faster turns travel further",
		get: (st) => Math.round(st.get("headTrackingAcceleration") * 10),
		min: 0,
		max: 10,
		set: (st, level) => st.set("headTrackingAcceleration", level / 10),
		format: (level) => String(level),
	},
	{
		id: "dwellTime",
		name: "Dwell time",
		sub: "How long to hold still before a dwell click",
		get: (st) => Math.round((st.get("dwellTime") ?? 1000) / 100),
		min: 6,
		max: 20,
		set: (st, step) => st.set("dwellTime", step * 100),
		format: (step) => `${(step / 10).toFixed(1)}s`,
	},
];
