// One-app flow (started from VISION.bat): Start screen -> calibration with adaptive
// control mapping -> "Your controls" -> a 60-second guided "try it" -> free use.
// Everything here is operated by head pointing and dwell (or a wink), never a key.

import { h, setText } from "./dom.js";
import { markSvg } from "./mark-svg.js";
import { speak, cancelSpeech } from "./speech.js";
import { preflightReport } from "./preflight.js";

const DOTS = [
	{ id: "camera", label: "Camera" },
	{ id: "mic", label: "Microphone" },
	{ id: "internet", label: "Internet" },
	{ id: "assistant", label: "Voice assistant" },
];

/** Full-screen Start: the mark, one big dwell button, four status dots. */
export function openStartScreen({ layer, engine, onStart }) {
	let raf = 0;
	let closed = false;
	let micOk = null;
	let bus = null;
	let greetedFace = false;
	let spokenProblem = null;
	const WELCOME = "Welcome to VISION. Look at the Start button and hold still.";

	const dots = Object.fromEntries(DOTS.map(({ id, label }) => {
		const dot = h("span", { class: "status-pill__dot" });
		const el = h("span", { class: "start__dot" }, dot, h("span", {}, label));
		return [id, { el, dot }];
	}));
	const startBtn = h("button", { class: "btn btn--ember start__btn", "data-dwell": true, onclick: () => start() }, "Start");
	const hint = h("p", { class: "hero__lede" }, "Look at Start and hold your head still.");
	const problem = h("p", { class: "start__problem", role: "status", hidden: true });
	const screen = h("div", { class: "screen start", role: "dialog", "aria-modal": "true", "aria-label": "Start VISION" },
		h("div", { class: "screen__top" },
			h("div", { class: "brand" }, markSvg(24), h("span", { class: "brand__word" }, "VISION")),
		),
		h("div", { class: "screen__body screen__body--center" },
			h("div", { class: "hero" },
				h("div", { class: "hero-mark start__mark" }, markSvg(168)),
				h("h1", { class: "hero__title" }, "Use the whole computer ", h("em", {}, "with your face and voice.")),
				startBtn,
				hint,
			),
		),
		h("div", { class: "screen__foot start__foot" }, h("div", { class: "start__dots" }, ...Object.values(dots).map((d) => d.el)), problem),
	);
	layer.append(screen);

	// The head moves the cursor on this screen, so Start can be pressed by resting on it.
	engine.setPaused(false);
	speak(WELCOME);

	const checkMic = async () => {
		try {
			const devices = await navigator.mediaDevices.enumerateDevices();
			micOk = devices.some((d) => d.kind === "audioinput");
		} catch (_error) {
			micOk = false;
		}
	};
	checkMic();
	const micTimer = setInterval(checkMic, 5000);

	const setDot = (id, ok, warn = false) => {
		const color = ok === true ? "var(--ok)" : ok === false ? (warn ? "var(--warn)" : "var(--err)") : "var(--bone-3)";
		dots[id].dot.style.background = color;
	};

	function loop() {
		raf = requestAnimationFrame(loop);
		const state = engine.getState();
		const cam = state.camera?.status;
		const report = preflightReport({
			preflight: bus?.preflight, cameraStatus: cam, micOk, internet: bus?.internet, assistantSeen: Boolean(bus?.assistant?.seen),
		});
		for (const [id, ok] of Object.entries(report.dots)) setDot(id, ok, id === "assistant");
		problem.hidden = !report.line;
		setText(problem, report.line ?? "");
		// One spoken line per new problem (then the welcome again), never a dialog.
		if (report.line && report.line !== spokenProblem) {
			spokenProblem = report.line;
			speak(`${report.line} ${WELCOME}`);
		}
		if (cam === "error") {
			setText(hint, "The camera is busy or unplugged. VISION keeps trying.");
		} else if (state.status === "no-face") {
			setText(hint, "Look at the camera.");
		} else if (state.status === "tracking") {
			setText(hint, "Look at Start and hold your head still.");
			if (!greetedFace) {
				greetedFace = true;
			}
		}
	}
	loop();

	function close() {
		if (closed) return;
		closed = true;
		cancelAnimationFrame(raf);
		clearInterval(micTimer);
		screen.remove();
	}

	function start() {
		cancelSpeech();
		close();
		onStart?.();
	}

	return { close, setBus: (state) => { bus = state; }, isOpen: () => !closed };
}

/**
 * The guided "try it" (about 60 s): reach three targets, click, then talk to the orb.
 * `plan`: the accepted control map, so the click step says the right thing.
 */
export function openTryIt({ layer, plan, onDone }) {
	let closed = false;
	let stepTimer = 0;
	const deadline = setTimeout(() => finish(), 75000);

	const instruction = h("div", { class: "instruction" }, "");
	const sub = h("div", { class: "instruction__sub" }, "");
	const stage = h("div", { class: "tryit__stage" });
	const progress = [h("span", { class: "steps__item" }, "1 · MOVE"), h("span", { class: "steps__item" }, "2 · CLICK"), h("span", { class: "steps__item" }, "3 · TALK")];
	const foot = h("div", { class: "screen__foot" },
		h("span", { class: "label" }, "TRY IT · ABOUT A MINUTE"),
		h("div", { class: "session__spacer" }),
		h("button", { class: "btn btn--ghost", "data-dwell": true, onclick: () => next() }, "Skip"),
	);
	const screen = h("div", { class: "screen screen--large tryit", role: "dialog", "aria-modal": "true", "aria-label": "Try VISION" },
		h("div", { class: "screen__top" },
			h("div", { class: "brand" }, markSvg(24), h("span", { class: "brand__word" }, "VISION"), h("span", { class: "brand__rule" }), h("span", { class: "brand__sub" }, "Try it")),
			h("div", { class: "steps" }, ...progress),
		),
		h("div", { class: "tryit__body" }, h("div", { class: "tryit__text" }, instruction, sub), stage),
		foot,
	);
	layer.append(screen);

	let step = -1;
	const steps = [moveStep, clickStep, talkStep];

	function next() {
		clearTimeout(stepTimer);
		step++;
		progress.forEach((chip, i) => {
			chip.classList.toggle("is-current", i === step);
			chip.classList.toggle("is-done", i < step);
		});
		stage.replaceChildren();
		if (step >= steps.length) {
			finish();
			return;
		}
		steps[step]();
	}

	function moveStep() {
		setText(instruction, "Move the cursor to each circle.");
		setText(sub, "Turn your head gently. Each circle lights up when you reach it.");
		speak("Let's try it. Move the cursor to each circle by turning your head.");
		const spots = [[18, 30], [78, 24], [50, 78]];
		let index = 0;
		const target = h("div", { class: "tryit__target", "aria-label": "Target" }, "1");
		stage.append(target);
		const place = () => {
			const [x, y] = spots[index];
			target.style.left = `${x}%`;
			target.style.top = `${y}%`;
			target.textContent = String(index + 1);
		};
		place();
		let hoverTimer = 0;
		target.addEventListener("pointerenter", () => {
			hoverTimer = setTimeout(() => {
				target.classList.add("is-hit");
				setTimeout(() => {
					target.classList.remove("is-hit");
					index++;
					if (index >= spots.length) {
						next();
					} else {
						place();
					}
				}, 260);
			}, 300);
		});
		target.addEventListener("pointerleave", () => clearTimeout(hoverTimer));
		stepTimer = setTimeout(next, 25000);
	}

	function clickStep() {
		const dwell = plan?.leftClick === "dwell";
		setText(instruction, dwell ? "Rest on the button to click it." : "Point at the button and wink your left eye.");
		setText(sub, dwell ? "Hold the cursor still until the ring fills." : "A wink is a click. Try it on the button.");
		speak(dwell ? "Now click. Rest the cursor on the button until the ring fills." : "Now click. Point at the button and wink your left eye.");
		const btn = h("button", { class: "btn btn--ember tryit__click", "data-dwell": dwell ? true : null, onclick: () => {
			btn.textContent = "Clicked!";
			speak("Nice.");
			stepTimer = setTimeout(next, 900);
		} }, "Click me");
		if (!dwell) btn.removeAttribute("data-dwell");
		stage.append(btn);
		stepTimer = setTimeout(next, 25000);
	}

	function talkStep() {
		setText(instruction, "Now look at the orb and say: “open YouTube”.");
		setText(sub, "The orb is at the bottom of the screen. Rest on it, then speak.");
		speak("Now look at the orb at the bottom of the screen, and say: open YouTube.");
		stage.append(
			h("div", { class: "tryit__orb-hint" }, h("span", { class: "label label--ember" }, "THE ORB IS DOWN HERE"), h("span", { class: "tryit__arrow" }, "↓")),
			h("button", { class: "btn btn--ember btn--wide tryit__done", "data-dwell": true, onclick: () => next() }, "I'm done"),
		);
		stepTimer = setTimeout(next, 30000);
	}

	function finish() {
		if (closed) return;
		closed = true;
		clearTimeout(stepTimer);
		clearTimeout(deadline);
		screen.remove();
		speak("You're all set. VISION is yours. Say VISION, back to start, when you are finished.");
		onDone?.();
	}

	next();
	return { close: () => { if (!closed) { closed = true; clearTimeout(stepTimer); clearTimeout(deadline); screen.remove(); } } };
}
