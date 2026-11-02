// Cursor & Click card: large − value + steppers (every step is a 64px dwell target)
// and plain-language toggles. Talks only to engine.settings.

import { h, setText, clamp, icons } from "./dom.js";

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
		name: "Sensitivity",
		sub: "Cursor travel per turn",
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
		sub: "Rest this long to click",
		get: (st) => Math.round((st.get("dwellTime") ?? 800) / 100),
		min: 6,
		max: 15,
		set: (st, step) => st.set("dwellTime", step * 100),
		format: (step) => `${(step / 10).toFixed(1)}s`,
	},
];

const MOUTH_MODES = ["open-mouth-simple", "open-mouth", "open-mouth-ignoring-eyes"];

export const TOGGLES = [
	{
		id: "dwellClick",
		name: "Dwell click",
		sub: "rest to click",
		get: (st) => st.get("clickingMode") === "dwell",
		// Dwell and mouth clicking are exclusive; with both off, winks click.
		set: (st, on) => st.set("clickingMode", on ? "dwell" : "blink"),
	},
	{
		id: "dwellDrag",
		name: "Dwell drag",
		sub: "rest to grab",
		get: (st) => Boolean(st.get("dwellDrag")),
		set: (st, on) => st.set("dwellDrag", on),
	},
	{
		id: "tiltScroll",
		name: "Tilt scroll",
		sub: "open mouth + tilt",
		get: (st) => st.get("mouthTiltScroll") !== false,
		set: (st, on) => st.set("mouthTiltScroll", on),
	},
	{
		id: "mouthClick",
		name: "Mouth click",
		sub: "open to click",
		get: (st) => MOUTH_MODES.includes(st.get("clickingMode")),
		set: (st, on) => st.set("clickingMode", on ? "open-mouth-simple" : "blink"),
	},
];

export function createControls({ steppersEl, togglesEl, settings, onChange = () => { } }) {
	const stepperViews = STEPPERS.map((def) => {
		const value = h("span", { class: "stepper__value" }, "–");
		const minus = h("button", { class: "stepper__btn", "data-dwell": true, "aria-label": `Decrease ${def.name}` }, icons.minus());
		const plus = h("button", { class: "stepper__btn", "data-dwell": true, "aria-label": `Increase ${def.name}` }, icons.plus());
		const step = (delta) => {
			const current = def.get(settings);
			const next = clamp(current + delta, def.min, def.max);
			if (next !== current) {
				def.set(settings, next, current);
				onChange(def.id);
			}
			refresh();
		};
		minus.addEventListener("click", () => step(-1));
		plus.addEventListener("click", () => step(1));
		const el = h("div", { class: "stepper", role: "group", "aria-label": def.name },
			h("div", { class: "stepper__title" }, h("span", { class: "stepper__name" }, def.name), h("span", { class: "stepper__sub" }, def.sub)),
			h("div", { class: "stepper__row" }, minus, value, plus),
		);
		steppersEl.append(el);
		return { def, value, minus, plus };
	});

	const toggleViews = TOGGLES.map((def) => {
		const el = h("button", { class: "toggle", role: "switch", "aria-checked": "false", "data-dwell": true },
			h("span", { class: "toggle__name" }, def.name),
			h("span", { class: "toggle__sub" }, def.sub),
		);
		el.addEventListener("click", () => {
			def.set(settings, !def.get(settings));
			onChange(def.id);
			refresh();
		});
		togglesEl.append(el);
		return { def, el };
	});

	function refresh() {
		for (const { def, value, minus, plus } of stepperViews) {
			const level = def.get(settings);
			setText(value, def.format(level));
			minus.disabled = level <= def.min;
			plus.disabled = level >= def.max;
		}
		for (const { def, el } of toggleViews) {
			el.setAttribute("aria-checked", String(def.get(settings)));
		}
	}
	refresh();
	return { refresh };
}
