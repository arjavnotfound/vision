// Voice: status with reason and action, the wake phrase, Voice keys, recent activity.

import { h, setText } from "../dom.js";
import { pageHead, card, button } from "./kit.js";
import { PAGE_LINES, wakeWords } from "./model.js";

export function createVoicePage(ctx) {
	const statusTitle = h("span", { class: "voice-status__state" });
	const statusReason = h("span", { class: "voice-status__reason" });
	const statusAction = h("div", { class: "voice-status__action" });
	const wakeLine = h("p", { class: "ucard__line" });
	const keysLine = h("p", { class: "ucard__line" });
	const list = h("ol", { class: "activity" });

	const el = h("div", { class: "page--voice" },
		pageHead("Voice", PAGE_LINES.voice),
		card("Status", h("div", { class: "voice-status", role: "status", "aria-live": "polite" }, statusTitle, statusReason), statusAction),
		h("div", { class: "voice-grid" },
			card("Wake phrase", wakeLine, button("Change wake phrase", () => ctx.navigate("settings-voice"))),
			card("Voice keys",
				h("p", { class: "ucard__line" }, "VISION reads its voice keys from keys.env on this computer, so a helper types them only once."),
				keysLine,
				button("Voice keys", () => ctx.navigate("settings-voice"))),
		),
		card("Recent activity", list),
	);

	let last = "";
	function draw() {
		const v = ctx.voiceStatus();
		const key = `${v.text}|${ctx.wakePhrase()}|${ctx.activity.length}`;
		if (key === last) return;
		last = key;
		setText(statusTitle, v.state);
		setText(statusReason, v.reason ? `· ${v.reason}` : "");
		statusAction.replaceChildren(...(v.action ? [button(v.action.label, () => ctx.voiceAction(v.action), { primary: true })] : []));
		setText(wakeLine, `Say “${wakeWords(ctx.wakePhrase())}” to start talking. Then say what you want, like “open Chrome” or “scroll down”.`);
		setText(keysLine, v.reason === "Voice keys missing" ? "No keys are saved yet." : v.reason === "Key not accepted" ? "A saved key was not accepted." : "Keys are saved.");
		list.replaceChildren(...(ctx.activity.length
			? ctx.activity.slice(0, 6).map((item) => h("li", { class: "activity__item" }, h("span", { class: "activity__time" }, item.time), h("span", {}, item.text)))
			: [h("li", { class: "activity__empty" }, "Nothing yet. What you ask VISION to do shows here.")]));
	}

	return {
		el,
		enter: () => { last = ""; ctx.refreshVoice(); draw(); },
		update: draw,
	};
}
