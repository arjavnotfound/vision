// Gesture help card (UX spec 6): what clicks, what scrolls, what opens the keyboard and what
// pauses, read from the current settings. The same component sits in Help and the island
// menu's Help. mount(el, { settings }) where settings has get(key) / has(key).

import { h } from "./dom.js";
import { ensureBuildDStyles } from "./d-style.js";

const DEFAULTS = { clickWink: true, clickBlink: false, clickMouth: false, clickDwell: false, dwellTime: 1000, pauseMethod: "blinks3", eyebrowRaiseOpensKeyboard: true };

/** Groups of [gesture, what it does], only for what is switched on. */
export function gestureRows(settings) {
	const get = (key) => (settings?.has?.(key) ? settings.get(key) : DEFAULTS[key]);
	const click = [];
	if (get("clickWink")) click.push(["Wink your left eye", "Left click"], ["Wink your right eye", "Right click"]);
	if (get("clickBlink")) click.push(["Blink both eyes on purpose", "Click"]);
	if (get("clickMouth")) click.push(["Open your mouth", "Click"]);
	if (get("clickDwell")) click.push([`Hold the cursor still for ${(Number(get("dwellTime")) / 1000).toFixed(1)} s`, "Click"]);
	const groups = [
		{ title: "What clicks", rows: click.length ? click : [["Nothing is set to click", "Turn on a click method in Settings"]] },
		{ title: "What scrolls", rows: [["Open your mouth and tilt your head", "Scroll"]] },
	];
	if (get("eyebrowRaiseOpensKeyboard")) groups.push({ title: "Keyboard", rows: [["Raise your eyebrows for 3 s", "Opens the on-screen keyboard"]] });
	groups.push({
		title: "What pauses",
		rows: [
			[get("pauseMethod") === "closeEyes" ? "Close your eyes for 2 s" : "Three quick blinks", "Pause or resume face control"],
			["F9", "Pause for a helper"],
		],
	});
	return groups;
}

export function mount(el, { settings } = {}) {
	ensureBuildDStyles();
	const card = h("div", { class: "card gesture-card" });
	el.append(card);
	const refresh = () => card.replaceChildren(
		h("div", { class: "card__head" }, h("h2", { class: "d-title" }, "What each gesture does")),
		...gestureRows(settings).map((group) => h("div", { class: "gesture-card__group" },
			h("h3", { class: "gesture-card__title" }, group.title),
			...group.rows.map(([how, what]) => h("div", { class: "gesture-card__row" },
				h("span", { class: "gesture-card__how" }, how),
				h("span", { class: "gesture-card__what" }, what))),
		)),
	);
	refresh();
	return { el: card, refresh, destroy: () => card.remove() };
}
