// First-run onboarding: three short screens, each spoken aloud, each moving on by itself.
//   1. Welcome: spoken, then moves on after WELCOME_MS.
//   2. Camera: moves on once the face has been framed well for FRAMED_HOLD_MS.
//   3. Calibrate: starts calibration after CALIBRATE_COUNTDOWN_MS unless the user picks Skip.
// The only buttons are Back, Repeat and Skip: nothing has to be pressed to get through.
// Camera problems are handled (and spoken) by the recovery monitor in main.js.

import { h, setText } from "./dom.js";
import { markSvg } from "./mark-svg.js";
import { createViewfinder } from "./viewfinder.js";
import { speak, cancelSpeech } from "./speech.js";

export const WELCOME_MS = 14000;
export const FRAMED_HOLD_MS = 2000;
export const CALIBRATE_COUNTDOWN_MS = 10000;

const LINES = [
	"Welcome to VISION. Turn your head to move the cursor. Rest the cursor on a button, or wink, to click. Close both eyes for 2 seconds to start or pause the cursor. Setup takes about two minutes and moves on by itself.",
	"Let VISION see you. Sit about an arm's length from the screen and face the camera. VISION moves on when it can see you clearly.",
	"Last step: calibration. It learns how you turn your head and how you wink. It starts in 10 seconds. To skip it, rest the cursor on Skip for now.",
];

export function openOnboarding({ layer, engine, onCalibrate, onFinish, startAt = 0, auto = true }) {
	let viewfinder = null;
	let raf = 0;
	let timer = 0;
	let index = 0;
	const steps = [h("span", { class: "steps__item" }, "1 · WELCOME"), h("span", { class: "steps__item" }, "2 · CAMERA"), h("span", { class: "steps__item" }, "3 · CALIBRATE")];
	const body = h("div", { class: "screen__body screen__body--center" });
	const foot = h("div", { class: "screen__foot" });
	const screen = h("div", { class: "screen", role: "dialog", "aria-modal": "true", "aria-label": "Welcome to VISION" },
		h("div", { class: "screen__top" },
			h("div", { class: "brand" }, markSvg(24), h("span", { class: "brand__word" }, "VISION"), h("span", { class: "brand__rule" }), h("span", { class: "brand__sub" }, "Face control")),
			h("div", { class: "steps" }, ...steps),
			h("div", { class: "titlebar__spacer" }),
			h("button", { class: "btn btn--ghost", "data-dwell": true, onclick: () => finish(false) }, "Skip setup"),
		),
		body,
		foot,
	);
	layer.append(screen);

	const progress = h("span", { class: "label label--ember onboarding__next" }, "");
	const repeat = () => h("button", { class: "btn", "data-dwell": true, onclick: () => show(index) }, "Repeat");
	const back = (to) => h("button", { class: "btn", "data-dwell": true, onclick: () => show(to) }, "Back");

	// Counts down `ms` on screen, then runs `done`. Static in preview screenshots.
	function countdown(ms, label, done) {
		const end = performance.now() + ms;
		const tick = () => {
			const left = Math.max(0, Math.ceil((end - performance.now()) / 1000));
			setText(progress, `${label} IN ${left} S`);
			if (left === 0) return done();
			timer = setTimeout(tick, 250);
		};
		if (auto) tick();
		else setText(progress, `${label} IN ${Math.round(ms / 1000)} S`);
	}

	function show(next) {
		index = next;
		steps.forEach((chip, i) => {
			chip.classList.toggle("is-current", i === index);
			chip.classList.toggle("is-done", i < index);
		});
		clearTimeout(timer);
		cancelAnimationFrame(raf);
		viewfinder?.destroy();
		viewfinder = null;
		foot.replaceChildren();
		speak(LINES[index]);
		if (index === 0) {
			body.className = "screen__body screen__body--center";
			body.replaceChildren(h("div", { class: "hero" },
				h("div", { class: "hero-mark" }, markSvg(96)),
				h("h1", { class: "hero__title" }, "Control your computer ", h("em", {}, "with your head.")),
				h("p", { class: "hero__lede" }, "Turn your head to move the cursor. Rest on a button or wink to click. No hands needed."),
				h("div", { class: "feature-row" },
					h("div", { class: "feature" }, h("span", { class: "label label--ember" }, "MOVE"), h("span", { class: "feature__name" }, "Head pointing"), h("span", { class: "feature__text" }, "Small head movements steer the cursor.")),
					h("div", { class: "feature" }, h("span", { class: "label label--ember" }, "CLICK"), h("span", { class: "feature__name" }, "Rest or wink"), h("span", { class: "feature__text" }, "Rest the cursor on a button, or wink.")),
					h("div", { class: "feature" }, h("span", { class: "label label--ember" }, "START · PAUSE"), h("span", { class: "feature__name" }, "Close both eyes"), h("span", { class: "feature__text" }, "Close both eyes for 2 seconds to start or pause the cursor.")),
				),
				h("p", { class: "prose" }, "VISION reads every step aloud and moves on by itself."),
			));
			foot.append(h("span", { class: "label" }, "STEP 1 OF 3"), repeat(), h("div", { class: "session__spacer" }), progress);
			countdown(WELCOME_MS, "NEXT STEP", () => show(1));
		} else if (index === 1) {
			body.className = "screen__body";
			const vfPanel = h("div", { class: "panel screen__vf" });
			const vfHost = h("div");
			vfPanel.append(vfHost);
			const status = h("div", { class: "instruction__sub" }, "");
			const check = (label) => {
				const dot = h("span", { class: "status-pill__dot" });
				const row = h("div", { class: "measure" }, h("span", { class: "measure__name" }, label), h("span", { class: "measure__state" }, dot));
				return { row, dot };
			};
			const camCheck = check("Camera connected");
			const faceCheck = check("Face found");
			const lightCheck = check("Enough light");
			const frameCheck = check("Face centred in the guide");
			body.replaceChildren(vfPanel, h("div", { class: "screen__side" },
				h("div", { class: "instruction" }, "Let VISION see you."),
				h("div", { class: "instruction__sub" }, "Sit about an arm's length from the screen and face the camera. VISION moves on by itself when it can see you clearly."),
				h("div", { class: "measure-list" }, camCheck.row, faceCheck.row, lightCheck.row, frameCheck.row),
				status,
			));
			viewfinder = createViewfinder(vfHost, { engine, readouts: false, guide: true, hint: true });
			const setDot = (c, ok, warn = false) => {
				c.dot.style.background = ok ? "var(--ok)" : warn ? "var(--warn)" : "var(--bone-3)";
			};
			let framedSince = null;
			const loop = () => {
				raf = requestAnimationFrame(loop);
				const state = engine.getState();
				viewfinder.update(state, engine.getFrame());
				const framed = state.faceFound && Boolean(state.framing?.ok);
				setDot(camCheck, state.camera?.status === "on", state.camera?.status === "error");
				setDot(faceCheck, state.faceFound, !state.faceFound);
				setDot(lightCheck, state.framing?.code !== "dark", state.framing?.code === "dark");
				setDot(frameCheck, Boolean(state.framing?.ok), !state.framing?.ok);
				const now = performance.now();
				framedSince = framed ? (framedSince ?? now) : null;
				if (state.camera?.status === "error") setText(status, "The camera is not working yet. VISION keeps trying by itself.");
				else if (framed) setText(status, "Looks good. Hold still…");
				else setText(status, `Tip: ${state.framing?.hint?.toLowerCase() ?? "look at the camera"}.`);
				setText(progress, framed ? `MOVING ON IN ${Math.max(0, Math.ceil((FRAMED_HOLD_MS - (now - framedSince)) / 1000))} S` : "WAITING TO SEE YOU");
				if (auto && framed && now - framedSince >= FRAMED_HOLD_MS) show(2);
			};
			loop();
			foot.append(back(0), repeat(), h("div", { class: "session__spacer" }), progress);
		} else {
			body.className = "screen__body screen__body--center";
			body.replaceChildren(h("div", { class: "hero" },
				h("div", { class: "hero-mark" }, markSvg(96)),
				h("h1", { class: "hero__title" }, "Tune it to ", h("em", {}, "your face.")),
				h("p", { class: "hero__lede" }, "A one-minute calibration learns how far you turn your head and how you wink, open your mouth and raise your brows."),
				h("p", { class: "prose" }, "It starts by itself. Each step is read aloud."),
			));
			foot.append(back(1), repeat(), h("div", { class: "session__spacer" }),
				h("button", { class: "btn btn--ghost", "data-dwell": true, onclick: () => finish(false) }, "Skip for now"),
				progress);
			countdown(CALIBRATE_COUNTDOWN_MS, "CALIBRATION STARTS", () => finish(true));
		}
	}

	function finish(calibrate) {
		clearTimeout(timer);
		cancelAnimationFrame(raf);
		viewfinder?.destroy();
		cancelSpeech();
		screen.remove();
		onFinish?.();
		if (calibrate) onCalibrate?.();
		else speak("Setup done. Say Vision any time to talk to me.");
	}

	show(startAt);
	return { close: () => finish(false) };
}
