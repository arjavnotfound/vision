// The VISION window shell (UX spec 1): the left rail and one page at a time.
// Pages are created on first visit and kept, so the camera view is not rebuilt.
// A page is { el, enter?(section), leave?(), update?(state), refresh?() }.

import { h, s } from "./dom.js";
import { RAIL, resolvePage } from "./pages/model.js";

const PATHS = {
	home: ["M4 11l8-7 8 7v9h-5v-6h-6v6H4z"],
	face: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z", "M9 10h.01M15 10h.01", "M8.5 14.5c1.9 2 5.1 2 7 0"],
	voice: ["M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z", "M5.5 11a6.5 6.5 0 0 0 13 0", "M12 17.5V21"],
	settings: ["M12 5.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z", "M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z"],
	help: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z", "M9.5 9.2a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1.9-1.1 1.6v.5", "M12 16.8h.01"],
};
// The 8 teeth of the gear, drawn thick.
const GEAR_TEETH = "M12 2.5V5.5M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1";

export function railIcon(id) {
	return s("svg", { viewBox: "0 0 24 24", class: "rail__icon", "aria-hidden": "true" },
		...PATHS[id].map((d) => s("path", { d })),
		id === "settings" ? s("path", { d: GEAR_TEETH, class: "rail__teeth" }) : null);
}

export function createShell({ railEl, pagesEl, factories, onChange }) {
	const pages = {};
	let current = null;
	const items = RAIL.map((item) => {
		const btn = h("button", { class: "rail__item", "data-dwell": true, "data-page": item.id, onclick: () => navigate(item.id) },
			railIcon(item.id), h("span", { class: "rail__word" }, item.label));
		railEl.append(btn);
		return btn;
	});

	function navigate(name) {
		const { page, section, rail } = resolvePage(name);
		if (!factories[page]) return current;
		if (current && current !== page) {
			pages[current].leave?.();
			pages[current].el.hidden = true;
		}
		if (!pages[page]) {
			pages[page] = factories[page]();
			pages[page].el.classList.add("page");
			pagesEl.append(pages[page].el);
		}
		pages[page].el.hidden = false;
		current = page;
		pages[page].enter?.(section);
		for (const btn of items) {
			const on = btn.dataset.page === rail;
			btn.classList.toggle("is-current", on);
			if (on) btn.setAttribute("aria-current", "page");
			else btn.removeAttribute("aria-current");
		}
		onChange?.(page, section);
		return page;
	}

	return {
		navigate,
		current: () => current,
		page: (name) => pages[name] ?? null,
		update: (state) => pages[current]?.update?.(state),
		refresh: () => pages[current]?.refresh?.(),
	};
}
