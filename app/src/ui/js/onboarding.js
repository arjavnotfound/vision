// First-run onboarding: three screens in the same visual system.
//   1. "Control your computer with your head."
//   2. Camera permission + framing check (live viewfinder with the framing guide)
//   3. Run calibration, or skip.

import { h, setText } from "./dom.js";
import { markSvg } from "./mark-svg.js";
import { createViewfinder } from "./viewfinder.js";

export function openOnboarding({ layer, engine, onCalibrate, onFinish, startAt = 0 }) {
	let viewfinder = null;
	let raf = 0;
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

	const f9 = () => h("span", { class: "kbd" }, "F9");

	function show(index) {
		steps.forEach((chip, i) => {
			chip.classList.toggle("is-current", i === index);
			chip.classList.toggle("is-done", i < index);
		});
		cancelAnimationFrame(raf);
		viewfinder?.destroy();
		viewfinder = null;
		foot.replaceChildren();
		if (index === 0) {
			body.className = "screen__body screen__body--center";
			body.replaceChildren(h("div", { class: "hero" },
				h("div", { class: "hero-mark" }, markSvg(96)),
				h("h1", { class: "hero__title" }, "Control your computer ", h("em", {}, "with your head.")),
				h("p", { class: "hero__lede" }, "Turn your head to move the cursor. Wink, open your mouth or rest on a target to click. No hands needed."),
				h("div", { class: "feature-row" },
					h("div", { class: "feature" }, h("span", { class: "label label--ember" }, "MOVE"), h("span", { class: "feature__name" }, "Head pointing"), h("span", { class: "feature__text" }, "Small head movements steer the cursor across every screen.")),
					h("div", { class: "feature" }, h("span", { class: "label label--ember" }, "CLICK"), h("span", { class: "feature__name" }, "Face gestures"), h("span", { class: "feature__text" }, "Wink, open your mouth, or dwell. You choose what feels easy.")),
					h("div", { class: "feature" }, h("span", { class: "label label--ember" }, "STOP"), h("span", { class: "feature__name" }, "Always in control"), h("span", { class: "feature__text" }, ["Press ", f9(), " or move the mouse to take over instantly."])),
				),
			));
			foot.append(h("span", { class: "label" }, "STEP 1 OF 3"), h("div", { class: "session__spacer" }),
				h("button", { class: "btn btn--ember btn--wide", "data-dwell": true, onclick: () => show(1) }, "Get started"));
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
				h("div", { class: "instruction__sub" }, "Sit about an arm's length from the screen, face the camera, and fit your face inside the guide."),
				h("div", { class: "measure-list" }, camCheck.row, faceCheck.row, lightCheck.row, frameCheck.row),
				status,
			));
			viewfinder = createViewfinder(vfHost, { engine, readouts: false, guide: true, hint: true });
			const setDot = (c, ok, warn = false) => {
				c.dot.style.background = ok ? "var(--ok)" : warn ? "var(--warn)" : "var(--bone-3)";
			};
			const loop = () => {
				raf = requestAnimationFrame(loop);
				const state = engine.getState();
				viewfinder.update(state, engine.getFrame());
				setDot(camCheck, state.camera?.status === "on", state.camera?.status === "error");
				setDot(faceCheck, state.faceFound, !state.faceFound);
				setDot(lightCheck, state.framing?.code !== "dark", state.framing?.code === "dark");
				setDot(frameCheck, Boolean(state.framing?.ok), !state.framing?.ok);
				setText(status, state.camera?.status === "error" ? "The camera could not be opened. Close other apps using it, then choose Retry." : state.framing?.ok ? "Looks good." : `Tip: ${state.framing?.hint?.toLowerCase() ?? "look at the camera"}.`);
			};
			loop();
			foot.append(
				h("button", { class: "btn", "data-dwell": true, onclick: () => show(0) }, "Back"),
				h("button", { class: "btn", "data-dwell": true, onclick: () => engine.useCamera() }, "Retry camera"),
				h("div", { class: "session__spacer" }),
				h("button", { class: "btn btn--ember btn--wide", "data-dwell": true, onclick: () => show(2) }, "Continue"),
			);
		} else {
			body.className = "screen__body screen__body--center";
			body.replaceChildren(h("div", { class: "hero" },
				h("div", { class: "hero-mark" }, markSvg(96)),
				h("h1", { class: "hero__title" }, "Tune it to ", h("em", {}, "your face.")),
				h("p", { class: "hero__lede" }, "A one-minute calibration learns your centre, how far you like to turn, and how clearly you wink, open your mouth and raise your brows."),
				h("p", { class: "prose" }, ["Tracking starts paused. Press ", f9(), " to start moving the cursor with your head."]),
			));
			foot.append(
				h("button", { class: "btn", "data-dwell": true, onclick: () => show(1) }, "Back"),
				h("div", { class: "session__spacer" }),
				h("button", { class: "btn btn--ghost", "data-dwell": true, onclick: () => finish(false) }, "Skip for now"),
				h("button", { class: "btn btn--ember btn--wide", "data-dwell": true, onclick: () => finish(true) }, "Calibrate now"),
			);
		}
	}

	function finish(calibrate) {
		cancelAnimationFrame(raf);
		viewfinder?.destroy();
		screen.remove();
		onFinish?.();
		if (calibrate) onCalibrate?.();
	}

	show(startAt);
	return { close: () => finish(false) };
}
