// Face control: the camera with the mesh, the gesture meters and Calibrate.

import { h } from "../dom.js";
import { createViewfinder } from "../viewfinder.js";
import { createMeters } from "../meters.js";
import { pageHead, card, button } from "./kit.js";
import { PAGE_LINES } from "./model.js";

export function createFacePage(ctx) {
	const { engine } = ctx;
	const vfEl = h("div", { class: "viewfinder", id: "main-viewfinder" });
	const metersEl = h("div", { class: "meters", id: "meters" });
	const el = h("div", { class: "page--face" },
		pageHead("Face control", PAGE_LINES.face, button("Calibrate", () => ctx.startCalibration(), { primary: true, attrs: { id: "calibrate-btn" } })),
		h("div", { class: "face-grid" },
			h("section", { class: "viewfinder-panel panel", "aria-label": "Camera" }, vfEl),
			card("Gestures", h("p", { class: "ucard__line" }, "Each bar fills as you make the gesture. It lights up when VISION counts it."), metersEl),
		),
	);
	const viewfinder = createViewfinder(vfEl, { engine, readouts: false });
	const meters = createMeters(metersEl);
	engine.on("gesture", ({ gesture, action, phase }) => {
		if (phase === "start" || phase === undefined) meters.fire(gesture, action);
	});
	return {
		el,
		viewfinder,
		enter: () => viewfinder.setShown(ctx.windowShown()),
		leave: () => viewfinder.setShown(false),
		update(state) {
			viewfinder.update(state, engine.getFrame());
			meters.update(state);
		},
	};
}
