// Help: what each gesture does (chunk D's gesture card), voice examples, safety, and the
// way to Diagnostics. Diagnostics is its own page under Help.

import { h } from "../dom.js";
import { pageHead, card, button } from "./kit.js";
import { PAGE_LINES, wakeWords } from "./model.js";
import { mountFeature } from "./mounts.js";

const EXAMPLES = ["pause", "open Chrome", "scroll down", "where’s my cursor", "show VISION", "menu", "stop"];

export function createHelpPage(ctx) {
	const gestureSlot = h("div", { class: "mount-slot", "data-mount": "gesture-card" });
	const examples = h("ul", { class: "help-list" });
	const el = h("div", { class: "page--help" },
		pageHead("Help", PAGE_LINES.help, button("Diagnostics", () => ctx.navigate("diagnostics"))),
		h("div", { class: "help-grid" },
			gestureSlot,
			h("div", { class: "help-side" },
				card("Things to say", examples),
				card("If something goes wrong",
					h("p", { class: "ucard__line" }, "A helper can press F9 to pause face control, or move the mouse to take over at once."),
					h("p", { class: "ucard__line" }, "A held mouse button is always let go when VISION pauses, closes or stops."),
					h("p", { class: "ucard__line" }, "If the window is gone, hold the cursor on the island at the top of the screen, then choose Settings.")),
			),
		),
	);
	let gestureCard = null;
	mountFeature("gesture-card", gestureSlot, { settings: ctx.settings }).then((m) => { gestureCard = m; });
	return {
		el,
		enter() {
			gestureCard?.refresh?.();
			const wake = wakeWords(ctx.wakePhrase());
			examples.replaceChildren(...EXAMPLES.map((text) => h("li", {}, `“${wake}, ${text}”`)));
		},
	};
}

export function createDiagnosticsPage(ctx) {
	const slot = h("div", { class: "mount-slot", "data-mount": "diagnostics" });
	// The Diagnostics module draws its own title; this page adds only the way back.
	const el = h("div", { class: "page--diagnostics" },
		button("Back to Help", () => ctx.navigate("help"), { attrs: { class: "btn page__back" } }),
		slot);
	let mounted = null;
	return {
		el,
		// Mounted only while showing: it runs its own camera view and draw loop.
		enter() {
			mounted ??= mountFeature("diagnostics", slot, { engine: ctx.engine, diag: ctx.onDiag });
		},
		leave() {
			const was = mounted;
			mounted = null;
			was?.then((m) => m?.destroy?.());
		},
	};
}
