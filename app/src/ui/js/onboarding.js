// First run (UX spec 7): four steps, no timers. Each step is spoken aloud.
//   1. Welcome: "VISION lets you use this computer with your head, face and voice."
//   2. Camera:  live view with the mesh, "Centre your face." Moves on once framed for 1.5 s.
//   3. Calibrate (calibration.js, mounted on the same layer).
//   4. Try clicking: a card per click method (Wink, Blink, Mouth, Dwell). "Try it" listens
//      for that gesture and ticks it when it works; a "Use this" switch picks it. Wink is
//      pre-selected. Then the person tries the pause method once. Done goes Home.
// "Skip setup" stays visible on every step.
//
// mount(el, { engine, onFinish(choice), hasVoiceKeys, startAt, auto, toast })

import { h, setText } from "./dom.js";
import { markSvg } from "./mark-svg.js";
import { createViewfinder } from "./viewfinder.js";
import { mount as mountCalibration } from "./calibration.js";
import { speak, cancelSpeech } from "./speech.js";
import { ensureBuildDStyles } from "./d-style.js";

export const FRAMED_HOLD_MS = 1500;
// A natural blink lasts about 100–150 ms, so a blink "click" must be held a little longer.
export const TRY_HOLD_MS = { wink: 120, blink: 250, mouth: 200 };

/** Is this click gesture being made right now? Uses the engine's own thresholds. */
export function gestureSeen(method, g) {
	const t = g?.thresholds;
	if (!t) return false;
	const l = g.leftEye?.ratio, r = g.rightEye?.ratio;
	const closed = (v) => Number.isFinite(v) && v <= t.eye.low;
	const open = (v) => Number.isFinite(v) && v > t.eye.high;
	if (method === "wink") return (closed(l) && open(r)) || (closed(r) && open(l));
	if (method === "blink") return closed(l) && closed(r);
	if (method === "mouth") return Number.isFinite(g.mouth?.ratio) && g.mouth.ratio >= t.mouth.high;
	return false;
}

/** Returns push(gestures, timeMs) -> true once the gesture has been held for its minimum time. */
export function createTryDetector(method, holdMs = TRY_HOLD_MS[method] ?? 150) {
	let since = null;
	return (g, t) => {
		since = gestureSeen(method, g) ? (since ?? t) : null;
		return since !== null && t - since >= holdMs;
	};
}

/** Settings for the chosen click methods. With nothing chosen, Wink stays on so something clicks. */
export function chooseMethods(chosen) {
	const any = ["wink", "blink", "mouth", "dwell"].some((m) => chosen[m]);
	return {
		clickWink: Boolean(chosen.wink) || !any,
		clickBlink: Boolean(chosen.blink),
		clickMouth: Boolean(chosen.mouth),
		clickDwell: Boolean(chosen.dwell),
	};
}

const METHODS = [
	{ id: "wink", name: "Wink", how: "Wink your left eye to left-click, your right eye to right-click.", listen: "Wink now." },
	{ id: "blink", name: "Blink", how: "Blink both eyes on purpose to click.", listen: "Blink both eyes, a little slower than usual." },
	{ id: "mouth", name: "Mouth", how: "Open your mouth to click.", listen: "Open your mouth." },
	{ id: "dwell", name: "Dwell", how: "Hold the cursor still to click.", listen: "Rest the cursor on the circle." },
];

const LINES = [
	"Welcome to VISION. VISION lets you use this computer with your head, face and voice. Turn your head to move the cursor. Wink, or rest the cursor on Start, to begin.",
	"Centre your face in the camera view. Sit about an arm's length from the screen. VISION moves on when it can see you clearly.",
	"",
	"Now try each way of clicking, and pick the ones you like. Wink is already picked. Then try pausing once.",
];

export function mount(el, { engine, onFinish, hasVoiceKeys = async () => false, startAt = 0, auto = true, toast, preview = null } = {}) {
	ensureBuildDStyles();
	let viewfinder = null;
	let calibration = null;
	let raf = 0;
	let index = 0;
	let finished = false;
	const chosen = { wink: true, blink: false, mouth: false, dwell: false };

	const chips = ["Welcome", "Camera", "Calibrate", "Try clicking"].map((label, i) => h("span", { class: "steps__item d-step" }, `${i + 1} · ${label}`));
	const skipBtn = () => h("button", { class: "btn btn--ghost", "data-dwell": true, onclick: () => finish() }, "Skip setup");
	const body = h("div", { class: "screen__body screen__body--center" });
	const foot = h("div", { class: "screen__foot" });
	const screen = h("div", { class: "screen d-screen", role: "dialog", "aria-modal": "true", "aria-label": "Welcome to VISION" },
		h("div", { class: "screen__top" },
			h("div", { class: "brand" }, markSvg(24), h("span", { class: "brand__word" }, "VISION"), h("span", { class: "brand__rule" }), h("span", { class: "brand__sub" }, "Setup")),
			h("div", { class: "steps" }, ...chips),
			h("div", { class: "titlebar__spacer" }),
			skipBtn(),
		),
		body,
		foot,
	);
	el.append(screen);

	const back = (to) => h("button", { class: "btn", "data-dwell": true, onclick: () => show(to) }, "Back");
	const say = (text) => { if (text && auto) speak(text); };

	function show(next) {
		index = next;
		chips.forEach((chip, i) => {
			chip.classList.toggle("is-current", i === index);
			chip.classList.toggle("is-done", i < index);
		});
		cancelAnimationFrame(raf);
		viewfinder?.destroy();
		viewfinder = null;
		foot.replaceChildren();
		screen.hidden = false;
		say(LINES[index]);
		if (index === 0) welcome();
		else if (index === 1) camera();
		else if (index === 2) calibrate();
		else tryClicking();
	}

	function welcome() {
		body.className = "screen__body screen__body--center";
		body.replaceChildren(h("div", { class: "hero" },
			h("div", { class: "hero-mark" }, markSvg(96)),
			h("h1", { class: "hero__title" }, "Welcome to VISION"),
			h("p", { class: "hero__lede" }, "VISION lets you use this computer with your head, face and voice."),
			h("p", { class: "prose" }, "Turn your head to move the cursor. Wink, or rest the cursor on Start, to begin. Each step is read aloud."),
		));
		foot.append(h("div", { class: "session__spacer" }), h("button", { class: "btn btn--ember btn--wide", "data-dwell": true, onclick: () => show(1) }, "Start"));
	}

	function camera() {
		body.className = "screen__body";
		const vfHost = h("div");
		const status = h("div", { class: "instruction__sub" }, "");
		body.replaceChildren(h("div", { class: "panel screen__vf" }, vfHost), h("div", { class: "screen__side" },
			h("div", { class: "instruction" }, "Centre your face."),
			h("div", { class: "instruction__sub" }, "Sit about an arm's length from the screen and face the camera. VISION moves on when it can see you clearly."),
			status,
		));
		viewfinder = createViewfinder(vfHost, { engine, readouts: false, guide: true, hint: true, mesh: true });
		let framedSince = null;
		const loop = () => {
			raf = requestAnimationFrame(loop);
			const state = engine.getState();
			viewfinder.update(state, engine.getFrame());
			const framed = state.faceFound && Boolean(state.framing?.ok);
			const now = performance.now();
			framedSince = framed ? (framedSince ?? now) : null;
			if (state.camera?.status === "error") setText(status, "The camera is not working yet. VISION tries again every few seconds.");
			else if (framed) setText(status, "Looks good. Hold still…");
			else if (state.framing?.code === "dark") setText(status, "More light on your face would help.");
			else setText(status, state.faceFound ? "Move so your face sits inside the oval." : "VISION can't see your face yet. Look at the camera.");
			if (auto && framed && now - framedSince >= FRAMED_HOLD_MS) show(2);
		};
		loop();
		foot.append(back(0), h("div", { class: "session__spacer" }), h("button", { class: "btn", "data-dwell": true, onclick: () => show(2) }, "Next"));
	}

	function calibrate() {
		screen.hidden = true;
		calibration = mountCalibration(el, {
			engine, toast, preview: auto ? null : (preview?.calibration ?? { step: "center" }),
			extraTop: skipBtn(),
			onClose: () => {
				calibration = null;
				if (!finished) show(3);
			},
		});
	}

	function tryClicking() {
		body.className = "screen__body d-try";
		const cards = METHODS.map((m) => {
			const status = h("span", { class: "try-card__status" }, "");
			const target = h(m.id === "dwell" ? "button" : "div", {
				class: "try-card__target",
				...(m.id === "dwell" ? { "data-dwell": true, "aria-label": "Dwell target", onclick: () => { if (card.listening) succeed(card); } } : { "aria-hidden": "true" }),
			});
			const useSwitch = h("button", { class: "toggle try-card__use", role: "switch", "aria-checked": String(chosen[m.id]), "data-dwell": true, onclick: () => {
				chosen[m.id] = !chosen[m.id];
				useSwitch.setAttribute("aria-checked", String(chosen[m.id]));
			} }, h("span", { class: "toggle__name" }, "Use this"));
			const tryBtn = h("button", { class: "btn", "data-dwell": true, onclick: () => listen(card) }, "Try it");
			const node = h("div", { class: "card try-card", dataset: { method: m.id } },
				h("h2", { class: "d-title" }, m.name),
				h("p", { class: "try-card__how" }, m.how),
				target, status, tryBtn, useSwitch);
			const card = { m, node, status, tryBtn, listening: false, done: false, detect: m.id === "dwell" ? null : createTryDetector(m.id) };
			return card;
		});
		const listen = (card) => {
			for (const c of cards) {
				c.listening = c === card && !c.done;
				c.node.classList.toggle("is-listening", c.listening);
				if (!c.done) setText(c.status, c.listening ? c.m.listen : "");
			}
			if (card.listening) say(card.m.listen);
		};
		const succeed = (card) => {
			card.done = true;
			card.listening = false;
			card.node.classList.remove("is-listening");
			card.node.classList.add("is-done");
			setText(card.status, "It worked. Use this?");
			setText(card.tryBtn, "Try again");
			card.tryBtn.onclick = () => { card.done = false; card.node.classList.remove("is-done"); listen(card); };
		};
		const st = engine.settings;
		const closeEyes = st?.has?.("pauseMethod") && st.get("pauseMethod") === "closeEyes";
		const pauseStatus = h("span", { class: "try-card__status" }, "");
		const pauseCard = h("div", { class: "card try-pause" },
			h("h2", { class: "d-title" }, "Pause"),
			h("p", { class: "try-card__how" }, `${closeEyes ? "Close your eyes for 2 seconds" : "Blink three times quickly"} to pause face control. You will hear the pause sound. Do it again to resume.`),
			pauseStatus);
		body.replaceChildren(h("div", { class: "try-grid" }, ...cards.map((c) => c.node)), pauseCard);
		foot.append(back(2), h("div", { class: "session__spacer" }), h("button", { class: "btn btn--ember btn--wide", "data-dwell": true, onclick: () => finish(true) }, "Done"));

		let pausedSeen = false;
		let pauseDone = false;
		if (preview?.tried) for (const id of preview.tried) succeed(cards.find((c) => c.m.id === id));
		if (preview?.listening) listen(cards.find((c) => c.m.id === preview.listening));
		if (!auto) return;
		const loop = () => {
			raf = requestAnimationFrame(loop);
			const now = performance.now();
			const g = engine.getState().gestures;
			for (const c of cards) if (c.listening && c.detect?.(g, now)) succeed(c);
			const paused = engine.isPaused();
			if (paused && !pausedSeen) {
				pausedSeen = true;
				setText(pauseStatus, "Paused. Do it again to resume.");
			} else if (!paused && pausedSeen && !pauseDone) {
				pauseDone = true;
				pauseCard.classList.add("is-done");
				setText(pauseStatus, "It worked. Face control is back on.");
			}
		};
		loop();
	}

	function finish(done = false) {
		if (finished) return;
		finished = true;
		cancelAnimationFrame(raf);
		viewfinder?.destroy();
		calibration?.close();
		cancelSpeech();
		const choice = done ? chooseMethods(chosen) : null;
		const st = engine.settings;
		if (choice) for (const [key, value] of Object.entries(choice)) if (st?.has?.(key)) st.set(key, value);
		screen.remove();
		onFinish?.(choice);
		if (auto) closingLine().then((line) => { console.log(`[first-run] closing: ${line}`); speak(line); });
	}

	// Says only what is true now: camera working or not, voice keys there or not.
	async function closingLine() {
		for (let i = 0; i < 30 && engine.getState().camera?.status === "starting"; i++) await new Promise((r) => setTimeout(r, 100));
		const cameraOn = engine.getState().camera?.status === "on";
		const voice = await hasVoiceKeys().catch(() => false);
		if (!cameraOn) return "Setup is closed, but the camera is not working yet. VISION tries again every few seconds.";
		if (!voice) return "Setup done. Face control is ready. Voice is off until a helper adds its keys in Settings.";
		return "Setup done. Say Hey Vision any time to talk to me.";
	}

	show(startAt);
	return { close: () => finish() };
}

/** Older entry point used by main.js until the wiring pass. Calibration now runs inside setup. */
export function openOnboarding(options) {
	return mount(options.layer, options);
}
