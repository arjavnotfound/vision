// Minimal DOM helpers (no framework).

const SVG_NS = "http://www.w3.org/2000/svg";

function applyAttrs(el, attrs, isSvg) {
	for (const [key, value] of Object.entries(attrs || {})) {
		if (value === undefined || value === null || value === false) {
			continue;
		}
		if (key === "class") {
			el.setAttribute("class", value);
		} else if (key === "dataset") {
			Object.assign(el.dataset, value);
		} else if (key === "style" && typeof value === "object") {
			for (const [prop, v] of Object.entries(value)) {
				el.style.setProperty(prop, v);
			}
		} else if (key.startsWith("on") && typeof value === "function") {
			el.addEventListener(key.slice(2).toLowerCase(), value);
		} else if (key === "text") {
			el.textContent = value;
		} else if (key === "html") {
			el.innerHTML = value;
		} else if (!isSvg && key in el && typeof value !== "string") {
			el[key] = value;
		} else {
			el.setAttribute(key, value === true ? "" : String(value));
		}
	}
}

function append(el, children) {
	for (const child of children.flat(Infinity)) {
		if (child === null || child === undefined || child === false) {
			continue;
		}
		el.append(child instanceof Node ? child : document.createTextNode(String(child)));
	}
}

/** Create an HTML element: h("button", { class: "btn", onclick }, "Text") */
export function h(tag, attrs = {}, ...children) {
	const el = document.createElement(tag);
	applyAttrs(el, attrs, false);
	append(el, children);
	return el;
}

/** Create an SVG element. */
export function s(tag, attrs = {}, ...children) {
	const el = document.createElementNS(SVG_NS, tag);
	applyAttrs(el, attrs, true);
	append(el, children);
	return el;
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Format a signed number with a fixed sign column: +03 / −12 */
export function signed(value, digits = 2) {
	const rounded = Math.round(value);
	const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : " ";
	return sign + String(Math.abs(rounded)).padStart(digits, "0");
}

/** Only touch the DOM when the text actually changes. */
export function setText(el, text) {
	if (el.textContent !== text) {
		el.textContent = text;
	}
}

export const icons = {
	minus: () => s("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, s("path", { d: "M6 12h12" })),
	plus: () => s("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, s("path", { d: "M6 12h12M12 6v12" })),
	close: () => s("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", class: "btn__svg" }, s("path", { d: "M7 7l10 10M17 7L7 17" })),
	arrowLeft: () => s("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", class: "btn__svg" }, s("path", { d: "M15 6l-6 6 6 6" })),
	arrowRight: () => s("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", class: "btn__svg" }, s("path", { d: "M9 6l6 6-6 6" })),
};
