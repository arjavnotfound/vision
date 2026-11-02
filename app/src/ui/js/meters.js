// Gesture meters: one row per gesture, a 24-segment level bar with the threshold notch, and
// the action the gesture is mapped to. While a gesture fires (and for 400 ms after the level
// drops) the row gets an ember border and fill, its segments and action label turn ember.

import { h, setText, clamp } from "./dom.js";

const SEGMENTS = 24;
const FIRE_HOLD_MS = 400;

// Each meter maps the raw engine measurement to 0..1, where "more" means "closer to firing".
export const METERS = [
	{
		id: "leftWink",
		name: "Left wink",
		read: (g) => g.leftEye?.ratio,
		// eye aspect ratio falls as the eye closes: show closure
		level: (ratio) => (0.35 - ratio) / 0.35,
		notches: (t) => ({ enter: (0.35 - t.eye.low) / 0.35, exit: (0.35 - t.eye.high) / 0.35 }),
		active: (g) => Boolean(g.leftEye?.active),
	},
	{
		id: "rightWink",
		name: "Right wink",
		read: (g) => g.rightEye?.ratio,
		level: (ratio) => (0.35 - ratio) / 0.35,
		notches: (t) => ({ enter: (0.35 - t.eye.low) / 0.35, exit: (0.35 - t.eye.high) / 0.35 }),
		active: (g) => Boolean(g.rightEye?.active),
	},
	{
		id: "mouth",
		name: "Mouth open",
		read: (g) => g.mouth?.ratio,
		level: (ratio) => ratio / 0.7,
		notches: (t) => ({ enter: t.mouth.high / 0.7, exit: t.mouth.low / 0.7 }),
		active: (g) => Boolean(g.mouth?.open),
	},
	{
		id: "brow",
		name: "Brow raise",
		read: (g) => g.brow?.ratio,
		level: (ratio) => (ratio - 0.12) / 0.3,
		notches: (t) => ({ enter: (t.brow.high - 0.12) / 0.3, exit: (t.brow.low - 0.12) / 0.3 }),
		active: (g) => Boolean(g.brow?.raised),
		hold: "HOLD 3S",
	},
	{
		id: "sleep",
		name: "Both eyes",
		read: (g) => g.sleep?.progress,
		level: (progress) => progress,
		notches: () => ({ enter: 0.98, exit: null }),
		active: (g) => (g.sleep?.progress ?? 0) > 0.05,
		hold: "HOLD 2S",
	},
];

export function createMeters(container) {
	const rows = new Map();
	for (const meter of METERS) {
		const segments = Array.from({ length: SEGMENTS }, () => h("i", { class: "meter__seg" }));
		const enter = h("u", { class: "meter__notch" });
		const exit = h("u", { class: "meter__notch meter__notch--exit" });
		const action = h("span", { class: "meter__action" }, "");
		const el = h("div", { class: "meter", dataset: { gesture: meter.id } },
			h("div", { class: "meter__row" }, h("span", { class: "meter__name" }, meter.name), action),
			h("div", { class: "meter__bar" }, ...segments, enter, exit),
		);
		container.append(el);
		rows.set(meter.id, { meter, el, segments, enter, exit, action, lastLit: -1, firingUntil: 0, firing: false, notchKey: "" });
	}

	function setFiring(row, firing) {
		if (row.firing !== firing) {
			row.firing = firing;
			row.el.classList.toggle("is-firing", firing);
		}
	}

	function update(state) {
		const now = performance.now();
		const g = state?.gestures;
		for (const row of rows.values()) {
			if (!g) {
				paint(row, 0);
				setFiring(row, false);
				continue;
			}
			const { meter } = row;
			const raw = meter.read(g);
			const level = Number.isFinite(raw) ? clamp(meter.level(raw), 0, 1) : 0;
			const notches = meter.notches(g.thresholds);
			const key = `${notches.enter}|${notches.exit}`;
			if (key !== row.notchKey) {
				row.notchKey = key;
				row.enter.style.left = `${clamp(notches.enter, 0, 1) * 100}%`;
				row.exit.hidden = notches.exit === null;
				if (notches.exit !== null) row.exit.style.left = `${clamp(notches.exit, 0, 1) * 100}%`;
			}
			const binding = g.bindings?.[meter.id] ?? "";
			const label = binding === "OFF" ? "OFF" : meter.hold ? `${binding} · ${meter.hold}` : binding;
			setText(row.action, label);
			row.action.classList.toggle("is-off", binding === "OFF");
			// Fire while active, and hold the highlight 400 ms after the level drops.
			if (meter.active(g) && binding !== "OFF") {
				row.firingUntil = now + FIRE_HOLD_MS;
			}
			setFiring(row, now < row.firingUntil);
			paint(row, level);
		}
	}

	function paint(row, level) {
		const lit = Math.round(level * SEGMENTS);
		if (lit === row.lastLit) return;
		row.lastLit = lit;
		for (let i = 0; i < SEGMENTS; i++) {
			row.segments[i].classList.toggle("is-on", i < lit);
		}
	}

	/** A gesture event arrived: make sure the row lights up even for very short gestures. */
	function fire(gestureId, action) {
		const row = rows.get(gestureId);
		if (!row || !action || action === "OFF") return;
		row.firingUntil = Math.max(row.firingUntil, performance.now() + FIRE_HOLD_MS);
		setFiring(row, true);
	}

	return { update, fire };
}
