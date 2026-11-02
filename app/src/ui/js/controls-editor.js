// "Your controls" editor: each action with its possible inputs as big dwell buttons.
// Used after calibration (to change VISION's pick) and in Settings → Clicking.

import { h } from "./dom.js";
import { ACTION_LABELS, INPUT_LABELS, INPUT_CHOICES, choosePlan } from "./control-map.js";

const SHORT = {
	leftWink: "Left wink",
	rightWink: "Right wink",
	dwell: "Dwell",
	brow: "Raise brows",
	voice: "Voice",
	mouth: "Mouth + tilt",
};

/**
 * @param {object} opts
 * @param {object} opts.plan current control map
 * @param {(plan: object) => void} opts.onChange called with the new, consistent plan
 * @param {(input: string) => string} [opts.note] small text under a row (e.g. measured strength)
 */
export function createControlsEditor({ plan, onChange, note = () => "" }) {
	let current = plan;
	const root = h("div", { class: "controls-map controls-map--edit" });
	function render() {
		root.replaceChildren(...Object.keys(INPUT_CHOICES).map((action) => {
			const chosen = current?.[action];
			return h("div", { class: "controls-map__row" },
				h("span", { class: "controls-map__action" }, ACTION_LABELS[action]),
				h("div", { class: "controls-map__choices", role: "radiogroup", "aria-label": ACTION_LABELS[action] },
					...INPUT_CHOICES[action].map((input) => h("button", {
						class: input === chosen ? "btn btn--ember controls-map__choice" : "btn controls-map__choice",
						"data-dwell": true,
						role: "radio",
						"aria-checked": String(input === chosen),
						title: INPUT_LABELS[input],
						onclick: () => {
							if (input === chosen) return;
							current = choosePlan(current, action, input);
							render();
							onChange(current);
						},
					}, SHORT[input] ?? input))),
				h("span", { class: "tech" }, note(chosen) || ""),
			);
		}));
	}
	render();
	return { el: root, set(plan) { current = plan; render(); }, get: () => current };
}