// Shared building blocks for the pages: page head, card, setting row, switch, stepper,
// choices. Every control is a 64 px dwell target.

import { h, setText, icons } from "../dom.js";

export function pageHead(title, line, ...actions) {
	return h("header", { class: "page__head" },
		h("div", { class: "page__heading" }, h("h1", { class: "page__title" }, title), h("p", { class: "page__line" }, line)),
		...actions);
}

export function card(title, ...children) {
	return h("section", { class: "ucard" }, title ? h("h2", { class: "ucard__title" }, title) : null, ...children);
}

/** One setting: name, one plain sentence, control. */
export function row(name, sentence, control, { wide = false } = {}) {
	return h("div", { class: wide ? "srow srow--wide" : "srow" },
		h("div", { class: "srow__text" }, h("span", { class: "srow__name" }, name), sentence ? h("span", { class: "srow__sentence" }, sentence) : null),
		h("div", { class: "srow__control" }, control));
}

export function switchControl({ label, get, set }) {
	const el = h("button", { class: "uswitch", role: "switch", "data-dwell": true, "aria-label": label },
		h("span", { class: "uswitch__track" }, h("span", { class: "uswitch__knob" })), h("span", { class: "uswitch__word" }));
	const draw = () => {
		el.setAttribute("aria-checked", String(Boolean(get())));
		setText(el.lastChild, get() ? "On" : "Off");
	};
	el.addEventListener("click", () => {
		set(!get());
		draw();
	});
	draw();
	return el;
}

/** Same stepping as the old Settings steppers (Stability relies on it). */
export function stepper({ label, get, set, min, max, step, format, onChange }) {
	const value = h("span", { class: "stepper__value" }, "");
	const minus = h("button", { class: "stepper__btn", "data-dwell": true, "aria-label": `Decrease ${label}` }, icons.minus());
	const plus = h("button", { class: "stepper__btn", "data-dwell": true, "aria-label": `Increase ${label}` }, icons.plus());
	const draw = () => {
		const v = get();
		setText(value, format(v));
		minus.disabled = v <= min + 1e-9;
		plus.disabled = v >= max - 1e-9;
	};
	minus.addEventListener("click", () => { set(Math.max(min, Math.round((get() - step) / step) * step)); draw(); onChange?.(); });
	plus.addEventListener("click", () => { set(Math.min(max, Math.round((get() + step) / step) * step)); draw(); onChange?.(); });
	draw();
	return h("div", { class: "stepper__row ustepper", role: "group", "aria-label": label }, minus, value, plus);
}

/** A row of radio buttons. items: [{ label, checked, onClick, disabled }] */
export function choices(label, items) {
	return h("div", { class: "uchoices", role: "radiogroup", "aria-label": label, style: { "--n": String(items.length) } },
		...items.map((item) => h("button", {
			class: "choice uchoice", role: "radio", "data-dwell": true, "aria-checked": String(Boolean(item.checked)),
			disabled: Boolean(item.disabled), onclick: item.onClick,
		}, item.label)));
}

export function button(label, onClick, { primary = false, danger = false, attrs = {} } = {}) {
	return h("button", { class: `btn ${primary ? "btn--ember" : danger ? "btn--danger" : ""}`.trim(), "data-dwell": true, onclick: onClick, ...attrs }, label);
}
