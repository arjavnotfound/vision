// Home: what VISION is doing right now. Face control and Voice status, one big
// Pause / Resume, "Where's my cursor" and the keyboard.

import { h, setText } from "../dom.js";
import { pageHead, card, button } from "./kit.js";
import { PAGE_LINES, faceStatus } from "./model.js";

export function createHomePage(ctx) {
	const { engine, settings } = ctx;
	const pauseWord = h("span", { class: "home-pause__word" }, "Pause");
	const pauseBtn = h("button", { class: "btn btn--ember home-pause", id: "pause-toggle", "data-dwell": true, "aria-pressed": "false", "aria-keyshortcuts": "F9", onclick: () => engine.togglePaused() },
		h("span", { class: "pause-toggle__icon", "aria-hidden": "true" }), pauseWord, h("span", { class: "home-pause__key" }, "F9"));
	const faceTitle = h("span", { class: "home-status__title" });
	const faceLine = h("p", { class: "home-status__line" });
	const voiceTitle = h("span", { class: "home-status__title" });
	const voiceLine = h("p", { class: "home-status__line" });
	const voiceAction = h("div", { class: "home-status__action" });

	const el = h("div", { class: "page--home" },
		pageHead("Home", PAGE_LINES.home),
		h("div", { class: "home-pause-row" }, pauseBtn),
		h("div", { class: "home-grid" },
			card("Face control", faceTitle, faceLine, h("div", { class: "home-status__action" }, button("Open Face control", () => ctx.navigate("face")))),
			card("Voice", voiceTitle, voiceLine, voiceAction),
		),
		h("div", { class: "home-tools" },
			button("Where’s my cursor", () => ctx.pulse()),
			button("Keyboard", () => engine.openOnScreenKeyboard()),
		),
	);

	let lastVoice = "";
	function drawVoice() {
		const v = ctx.voiceStatus();
		if (v.text === lastVoice) return;
		lastVoice = v.text;
		setText(voiceTitle, v.state);
		setText(voiceLine, v.reason ?? "");
		voiceAction.replaceChildren(v.action ? button(v.action.label, () => ctx.voiceAction(v.action)) : button("Open Voice", () => ctx.navigate("voice")));
	}

	return {
		el,
		enter: () => { lastVoice = ""; drawVoice(); },
		update(state) {
			const f = faceStatus(state, settings.get("pauseMethod"));
			setText(faceTitle, f.title);
			setText(faceLine, f.line);
			pauseBtn.setAttribute("aria-pressed", String(Boolean(state.paused)));
			setText(pauseWord, state.paused ? "Resume face control" : "Pause face control");
			drawVoice();
		},
	};
}
