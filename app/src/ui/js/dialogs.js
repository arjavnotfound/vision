// Confirm dialog. Every button is a 64 px dwell target.
// cancel: false drops the Cancel button and the click-outside dismiss, when `secondary`
// already declines and a stray click must not answer for the user.
// stacked: one button per row (a wrong dwell costs something), main button first.

import { h } from "./dom.js";

export function openConfirm(layer, { title, text, confirmLabel, danger = false, onConfirm, secondary = null, cancel = true, stacked = false }) {
	const scrim = h("div", { class: "scrim" });
	const close = () => {
		scrim.remove();
		box.remove();
	};
	const main = h("button", { class: `btn ${danger ? "btn--danger" : "btn--ember"} btn--wide`, "data-dwell": true, onclick: () => { close(); onConfirm(); } }, confirmLabel);
	const second = secondary
		? h("button", { class: `btn ${secondary.danger ? "btn--danger" : ""}`, "data-dwell": true, "data-dwell-delay": secondary.delay, onclick: () => { close(); secondary.onClick(); } }, secondary.label)
		: null;
	const cancelBtn = cancel ? h("button", { class: "btn", "data-dwell": true, onclick: close }, "Cancel") : null;
	const actions = stacked
		? h("div", { class: "confirm__actions confirm__actions--stacked" }, main, second, cancelBtn)
		: h("div", { class: "confirm__actions" }, second, h("div", { class: "session__spacer" }), cancelBtn, main);
	const box = h("div", { class: "confirm", role: "alertdialog", "aria-modal": "true", "aria-label": title },
		h("div", { class: "confirm__title" }, title),
		text ? h("div", { class: "prose" }, text) : null,
		actions,
	);
	if (cancel) scrim.addEventListener("click", close);
	layer.append(scrim, box);
	return { close, box };
}
