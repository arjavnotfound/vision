// Calibration wizard (AUDIT P1-2). Full window, one instruction at a time.
//   1. Centre  — look straight, hold 2 s (ring fills)
//   2. Range   — turn as far as is comfortable; arcs draw on the attitude indicator
//   3. Gestures — wink left, wink right, open mouth, raise brows (each once)
//   4. Done    — summary; accept by dwelling
// The cursor is frozen (tracking paused) during steps 1–3 so turning your head does not
// sweep the cursor across the desktop; it is restored for the summary, which you accept
// by dwelling. Results go only into existing settings (offsets, ranges, thresholds, sensitivity).

import { h, setText, signed } from "./dom.js";
import { markSvg } from "./mark-svg.js";
import { createViewfinder } from "./viewfinder.js";
import { createAttitude } from "./attitude.js";
import {
	summarizeCenter, summarizeRange, poseSettings, suggestSensitivityFactor,
	suggestThresholds, combineEyeSuggestions, thresholdSettings,
} from "./calibration-math.js";
import { assessGesture, planControls, controlSettings, describePlan } from "./control-map.js";
import { createControlsEditor } from "./controls-editor.js";
import { speak } from "./speech.js";

const STEPS = [
	{ id: "center", label: "CENTER" },
	{ id: "range", label: "RANGE" },
	{ id: "gestures", label: "GESTURES" },
	{ id: "done", label: "DONE" },
];

// `other`: for winks, the other eye is watched too, so a "wink" that closes both eyes
// is caught (adaptive control mapping).
const GESTURE_TASKS = [
	{ id: "leftWink", name: "Wink your left eye", kind: "eye", read: (g) => g.leftEye?.ratio, other: (g) => g.rightEye?.ratio, neutralKey: "leftEye", otherKey: "rightEye", extreme: "min" },
	{ id: "rightWink", name: "Wink your right eye", kind: "eye", read: (g) => g.rightEye?.ratio, other: (g) => g.leftEye?.ratio, neutralKey: "rightEye", otherKey: "leftEye", extreme: "min" },
	{ id: "mouth", name: "Open your mouth wide", kind: "mouth", read: (g) => g.mouth?.ratio, neutralKey: "mouth", extreme: "max" },
	{ id: "brow", name: "Raise your eyebrows", kind: "brow", read: (g) => g.brow?.ratio, neutralKey: "brow", extreme: "max" },
];

const CENTER_HOLD_MS = 2000;
const RANGE_MAX_MS = 12000;
const GESTURE_WINDOW_MS = 4500;

export function openCalibration({ layer, engine, profiles, toast, onClose, preview = null, adaptive = false, onPlan }) {
	const wasPaused = engine.isPaused();
	let stepIndex = 0;
	let raf = 0;
	let closed = false;

	// --- measurement state
	const centerSamples = [];
	let centerProgress = 0;
	let center = null;
	const rangeSamples = [];
	let rangeStart = 0;
	let range = null;
	let taskIndex = 0;
	let taskStart = 0;
	const peaks = {};
	const otherPeaks = {};
	let results = null;
	let plan = null;
	let assessment = null;
	const say = (text) => { if (adaptive && !preview) speak(text); };

	// --- layout
	const stepChips = STEPS.map((step, i) => h("span", { class: "steps__item" }, `${i + 1} · ${step.label}`));
	const cancelBtn = h("button", { class: "btn btn--ghost", "data-dwell": true, onclick: () => close(false) }, "Cancel");
	const vfPanel = h("div", { class: "panel screen__vf" });
	const vfHost = h("div");
	vfPanel.append(vfHost);
	const instruction = h("div", { class: "instruction" }, "");
	const sub = h("div", { class: "instruction__sub" }, "");
	const widget = h("div", { style: { flex: "1", "min-height": "0", display: "flex", "flex-direction": "column", gap: "14px" } });
	const foot = h("div", { class: "screen__foot" });

	const screen = h("div", { class: adaptive ? "screen screen--large" : "screen", role: "dialog", "aria-modal": "true", "aria-label": "Calibration" },
		h("div", { class: "screen__top" },
			h("div", { class: "brand" }, markSvg(24), h("span", { class: "brand__word" }, "VISION"), h("span", { class: "brand__rule" }), h("span", { class: "brand__sub" }, "Calibration")),
			h("div", { class: "steps" }, ...stepChips),
			h("div", { class: "titlebar__spacer" }),
			cancelBtn,
		),
		h("div", { class: "screen__body" }, vfPanel, h("div", { class: "screen__side" }, instruction, sub, widget)),
		foot,
	);
	layer.append(screen);
	const viewfinder = createViewfinder(vfHost, { engine, readouts: true, guide: true, hint: true, pausedMessage: false });

	// --- step widgets
	const holdRing = h("div", { class: "hold-ring" });
	const holdValue = h("span", { class: "dot-num" }, "0%");
	const holdWrap = h("div", { class: "hold-ring-wrap" }, holdRing, holdValue);

	const attitudeHost = h("div", { class: "attitude attitude--calib" });
	const attitude = createAttitude(attitudeHost, { tape: true });
	const dirChips = Object.fromEntries(["LEFT", "RIGHT", "UP", "DOWN"].map((d) => [d, h("span", { class: "steps__item" }, d)]));
	const rangeTimer = h("span", { class: "label" }, "");

	const measureRows = GESTURE_TASKS.map((task) => {
		const state = h("span", { class: "measure__state" }, "WAITING");
		const vals = h("div", { class: "measure__vals" });
		const el = h("div", { class: "measure" }, h("span", { class: "measure__name" }, task.name), state, vals);
		return { task, el, state, vals };
	});

	function setStep(index) {
		stepIndex = index;
		stepChips.forEach((chip, i) => {
			chip.classList.toggle("is-current", i === index);
			chip.classList.toggle("is-done", i < index);
		});
		widget.replaceChildren();
		foot.replaceChildren();
		const id = STEPS[index].id;
		if (id === "center") {
			setText(instruction, "Look straight at the screen and hold still.");
			setText(sub, "The ring fills while your face is steady. This becomes the centre of your screen.");
			say("Let us set up VISION for you. Look straight at the screen and hold still.");
			widget.append(holdWrap);
			foot.append(h("span", { class: "label" }, "THE CURSOR IS FROZEN WHILE YOU CALIBRATE"), h("div", { class: "session__spacer" }), skipButton("Skip step", () => setStep(1)));
		} else if (id === "range") {
			rangeStart = performance.now();
			setText(instruction, "Turn your head as far as is comfortable.");
			setText(sub, "Left, right, up and down. Only as far as feels easy — the arcs show your range.");
			say("Now turn your head left, right, up and down, only as far as is comfortable.");
			widget.append(attitudeHost, h("div", { class: "steps", style: { "margin-left": "0" } }, ...Object.values(dirChips)), rangeTimer);
			foot.append(h("span", { class: "label" }, "MOVES ON AUTOMATICALLY"), h("div", { class: "session__spacer" }), skipButton("Skip step", () => finishRange()));
		} else if (id === "gestures") {
			taskIndex = 0;
			taskStart = performance.now();
			setText(instruction, GESTURE_TASKS[0].name + ".");
			setText(sub, adaptive
				? "Do each gesture once or twice. VISION checks which ones work well for you and sets your controls."
				: "Do each gesture once, clearly. We compare it with the current threshold and suggest a better one.");
			say(`Now some face gestures. Do each one once or twice. ${GESTURE_TASKS[0].name}.`);
			widget.append(h("div", { class: "measure-list" }, ...measureRows.map((r) => r.el)));
			foot.append(h("span", { class: "label" }, "EACH GESTURE ONCE"), h("div", { class: "session__spacer" }), skipButton("Skip gesture", () => nextTask()));
		} else if (id === "done") {
			// Give the cursor back so the summary can be accepted by dwelling.
			engine.setPaused(wasPaused);
			renderSummary();
		}
	}

	function skipButton(label, onClick) {
		return h("button", { class: "btn", "data-dwell": true, onclick: onClick }, label);
	}

	function finishRange() {
		range = rangeSamples.length >= 10 ? summarizeRange(rangeSamples) : null;
		setStep(2);
	}

	function nextTask() {
		const row = measureRows[taskIndex];
		if (row) {
			row.el.classList.remove("is-current");
			row.el.classList.add("is-done");
			setText(row.state, Number.isFinite(peaks[row.task.id]) ? "MEASURED" : "SKIPPED");
		}
		taskIndex++;
		taskStart = performance.now();
		if (taskIndex >= GESTURE_TASKS.length) {
			computeResults();
			setStep(3);
		} else {
			setText(instruction, GESTURE_TASKS[taskIndex].name + ".");
			say(GESTURE_TASKS[taskIndex].name + ".");
		}
	}

	function computeResults() {
		const c = center ?? {};
		const eye = combineEyeSuggestions(
			suggestThresholds("eye", c.leftEye, peaks.leftWink),
			suggestThresholds("eye", c.rightEye, peaks.rightWink),
		);
		const mouth = suggestThresholds("mouth", c.mouth, peaks.mouth);
		const brow = suggestThresholds("brow", c.brow, peaks.brow);
		const pose = center && range ? poseSettings(center, range) : (center ? poseSettings(center, { yawMin: NaN, yawMax: NaN, pitchMin: NaN, pitchMax: NaN }) : {});
		const sensitivityFactor = range ? suggestSensitivityFactor(range) : 1;
		results = { eye, mouth, brow, pose, thresholds: thresholdSettings({ eye, mouth, brow }), sensitivityFactor };
		// Adaptive control mapping: which gestures work for this person.
		assessment = {
			leftWink: assessGesture("eye", { neutral: c.leftEye, peak: peaks.leftWink, otherNeutral: c.rightEye, otherPeak: otherPeaks.leftWink }),
			rightWink: assessGesture("eye", { neutral: c.rightEye, peak: peaks.rightWink, otherNeutral: c.leftEye, otherPeak: otherPeaks.rightWink }),
			mouth: assessGesture("mouth", { neutral: c.mouth, peak: peaks.mouth }),
			brow: assessGesture("brow", { neutral: c.brow, peak: peaks.brow }),
		};
		plan = planControls(assessment);
	}

	function renderSummary() {
		if (adaptive) {
			renderControls();
			return;
		}
		const r = results ?? { eye: {}, mouth: {}, brow: {}, pose: {}, thresholds: {}, sensitivityFactor: 1 };
		setText(instruction, "Calibrated. Here is what we measured.");
		setText(sub, "Apply it to your profile, or keep your current settings. Rest the cursor on a button to choose.");
		const item = (label, value, note) => h("div", { class: "summary__item" },
			h("span", { class: "label" }, label),
			h("span", { class: "dot-num" }, value),
			h("span", { class: "tech" }, note));
		const fmt = (sugg, current) => sugg?.ok ? `${sugg.low.toFixed(2)}/${sugg.high.toFixed(2)}` : current;
		const st = engine.settings;
		widget.append(h("div", { class: "summary" },
			item("CENTER", center ? `${signed(-center.yaw)}° ${signed(center.pitch)}°` : "—", "yaw · pitch at rest"),
			item("RANGE", range ? `${Math.round(range.yawMax - range.yawMin)}° × ${Math.round(range.pitchMax - range.pitchMin)}°` : "—", "comfortable yaw × pitch"),
			item("EYES", fmt(r.eye, `${st.get("eyeThresholdLow")}/${st.get("eyeThresholdHigh")}`), r.eye?.ok ? "suggested close / reopen" : `kept · ${r.eye?.reason ?? "not measured"}`),
			item("MOUTH", fmt(r.mouth, `${st.get("mouthThresholdLow")}/${st.get("mouthThresholdHigh")}`), r.mouth?.ok ? "suggested release / open" : `kept · ${r.mouth?.reason ?? "not measured"}`),
			item("BROWS", fmt(r.brow, `${st.get("browThresholdLow")}/${st.get("browThresholdHigh")}`), r.brow?.ok ? "suggested release / raise" : `kept · ${r.brow?.reason ?? "not measured"}`),
			item("SENSITIVITY", `×${r.sensitivityFactor.toFixed(2)}`, "from your range"),
		));
		foot.append(
			h("button", { class: "btn", "data-dwell": true, onclick: () => { stepIndex = 0; restart(); } }, "Run again"),
			h("div", { class: "session__spacer" }),
			h("button", { class: "btn btn--ghost", "data-dwell": true, onclick: () => close(false) }, "Keep current"),
			h("button", { class: "btn btn--ember btn--wide", "data-dwell": true, onclick: () => apply() }, `Apply to ${profiles?.active() ?? "profile"}`),
		);
	}

	/** "Your controls": each action, the input it now uses; accept or try again. */
	function renderControls() {
		const p = plan ?? planControls({});
		setText(instruction, "Your controls");
		setText(sub, "VISION picked what worked best for you. To change one yourself, rest on another choice. Then rest on Accept.");
		const strength = (name) => {
			const a = assessment?.[name];
			if (!a) return "";
			return a.reliable ? `${Math.round(a.strength * 100)}%` : a.reason.toUpperCase();
		};
		// Manual override: the person can move any action to another input themselves.
		plan = p;
		const editor = createControlsEditor({
			plan: p,
			onChange: (next) => { plan = next; },
			note: (input) => strength(input) ? `measured ${strength(input)}` : input === "voice" ? "look at the orb and speak" : input === "dwell" ? "rest the cursor on a target" : "",
		});
		widget.append(editor.el);
		const moved = describePlan(p).filter((row) => ["dwell", "voice"].includes(row.input) || (row.action === "rightClick" && row.input === "brow"));
		say(moved.length
			? `Your controls are ready. ${moved.map((row) => `${row.label}: ${row.how.replace(/[“”]/g, "")}.`).join(" ")} Look at Accept to continue.`
			: "Your controls are ready. Wink your left eye to click, and your right eye to right click. Look at Accept to continue.");
		foot.append(
			h("button", { class: "btn btn--wide", "data-dwell": true, onclick: () => { stepIndex = 0; restart(); } }, "Try again"),
			h("div", { class: "session__spacer" }),
			h("button", { class: "btn btn--ember btn--wide", "data-dwell": true, onclick: () => apply() }, "Accept"),
		);
	}

	function apply() {
		if (adaptive && plan) {
			const st = engine.settings;
			for (const [key, value] of Object.entries(controlSettings(plan))) {
				if (st.has(key)) st.set(key, value);
			}
			onPlan?.(plan, assessment);
		}
		if (results) {
			const st = engine.settings;
			for (const [key, value] of Object.entries({ ...results.pose, ...results.thresholds })) {
				if (st.has(key)) st.set(key, value);
			}
			if (results.sensitivityFactor !== 1) {
				for (const key of ["headTrackingSensitivityX", "headTrackingSensitivityY"]) {
					st.set(key, Math.round(Math.min(0.1, st.get(key) * results.sensitivityFactor) * 10000) / 10000);
				}
			}
			profiles?.saveActive();
			toast?.("Calibration saved to your profile.");
		}
		close(true);
	}

	function restart() {
		centerSamples.length = 0;
		rangeSamples.length = 0;
		centerProgress = 0;
		center = null;
		range = null;
		results = null;
		for (const key of Object.keys(peaks)) delete peaks[key];
		for (const key of Object.keys(otherPeaks)) delete otherPeaks[key];
		plan = null;
		assessment = null;
		for (const row of measureRows) {
			row.el.classList.remove("is-current", "is-done");
			setText(row.state, "WAITING");
			row.vals.replaceChildren();
		}
		attitude.setRange(null);
		engine.setPaused(true);
		setStep(0);
	}

	let lastTime = performance.now();
	function tick() {
		raf = requestAnimationFrame(tick);
		const now = performance.now();
		const dt = Math.min(100, now - lastTime);
		lastTime = now;
		const state = engine.getState();
		viewfinder.update(state, engine.getFrame());
		if (preview) return;
		const id = STEPS[stepIndex].id;
		const g = state.gestures || {};
		const sample = { yaw: state.pose.yaw, pitch: state.pose.pitch, leftEye: g.leftEye?.ratio, rightEye: g.rightEye?.ratio, mouth: g.mouth?.ratio, brow: g.brow?.ratio };

		if (id === "center") {
			const recent = centerSamples.slice(-20);
			const meanYaw = recent.reduce((a, s) => a + s.yaw, 0) / Math.max(1, recent.length);
			const meanPitch = recent.reduce((a, s) => a + s.pitch, 0) / Math.max(1, recent.length);
			const steady = state.faceFound && (recent.length < 5 || (Math.abs(sample.yaw - meanYaw) < 4 && Math.abs(sample.pitch - meanPitch) < 4));
			if (steady) {
				centerSamples.push(sample);
				centerProgress = Math.min(1, centerProgress + dt / CENTER_HOLD_MS);
			} else {
				centerProgress = Math.max(0, centerProgress - dt / CENTER_HOLD_MS);
				if (centerProgress === 0) centerSamples.length = 0;
			}
			holdRing.style.setProperty("--p", centerProgress.toFixed(3));
			setText(holdValue, `${Math.round(centerProgress * 100)}%`);
			if (centerProgress >= 1) {
				center = summarizeCenter(centerSamples.slice(-90));
				setStep(1);
			}
		} else if (id === "range") {
			attitude.update(state.pose);
			if (state.faceFound) rangeSamples.push(sample);
			if (rangeSamples.length > 4) {
				const r = summarizeRange(rangeSamples);
				const c = center ?? { yaw: 0, pitch: 0 };
				// user perspective: right positive (engine yaw is left-positive)
				attitude.setRange({ yawMin: -r.yawMax, yawMax: -r.yawMin, pitchMin: r.pitchMin, pitchMax: r.pitchMax, pitchNow: state.pose.pitch });
				dirChips.LEFT.classList.toggle("is-done", r.yawMax - c.yaw > 12);
				dirChips.RIGHT.classList.toggle("is-done", c.yaw - r.yawMin > 12);
				dirChips.UP.classList.toggle("is-done", r.pitchMax - c.pitch > 8);
				dirChips.DOWN.classList.toggle("is-done", c.pitch - r.pitchMin > 8);
			}
			const elapsed = now - rangeStart;
			const allDone = Object.values(dirChips).every((chip) => chip.classList.contains("is-done"));
			setText(rangeTimer, allDone ? "GOT IT" : `${Math.max(0, Math.ceil((RANGE_MAX_MS - elapsed) / 1000))}S LEFT`);
			if ((allDone && elapsed > 4000) || elapsed > RANGE_MAX_MS) {
				finishRange();
			}
		} else if (id === "gestures") {
			const task = GESTURE_TASKS[taskIndex];
			const row = measureRows[taskIndex];
			if (!task) return;
			row.el.classList.add("is-current");
			const value = task.read(g);
			if (Number.isFinite(value) && state.faceFound) {
				const prev = peaks[task.id];
				peaks[task.id] = !Number.isFinite(prev) ? value : task.extreme === "min" ? Math.min(prev, value) : Math.max(prev, value);
				const other = task.other?.(g);
				if (Number.isFinite(other)) {
					otherPeaks[task.id] = Number.isFinite(otherPeaks[task.id]) ? Math.min(otherPeaks[task.id], other) : other;
				}
			}
			const t = state.gestures?.thresholds;
			const threshold = task.kind === "eye" ? t?.eye.low : task.kind === "mouth" ? t?.mouth.high : t?.brow.high;
			const neutral = center?.[task.neutralKey];
			row.vals.replaceChildren(
				h("span", {}, "NOW ", h("b", {}, Number.isFinite(value) ? value.toFixed(2) : "—")),
				h("span", {}, "PEAK ", h("b", {}, Number.isFinite(peaks[task.id]) ? peaks[task.id].toFixed(2) : "—")),
				h("span", {}, "THRESHOLD ", h("b", {}, Number.isFinite(threshold) ? threshold.toFixed(2) : "—")),
				h("span", {}, "REST ", h("b", {}, Number.isFinite(neutral) ? neutral.toFixed(2) : "—")),
			);
			const elapsed = now - taskStart;
			setText(row.state, `${Math.max(0, Math.ceil((GESTURE_WINDOW_MS - elapsed) / 1000))}S`);
			if (elapsed > GESTURE_WINDOW_MS) {
				nextTask();
			}
		}
	}

	function onKey(event) {
		if (event.key === "Escape") close(false);
	}
	window.addEventListener("keydown", onKey);

	function close(applied) {
		if (closed) return;
		closed = true;
		cancelAnimationFrame(raf);
		window.removeEventListener("keydown", onKey);
		viewfinder.destroy();
		engine.setPaused(wasPaused);
		screen.remove();
		onClose?.(applied);
	}

	// Start
	if (preview) {
		applyPreview(preview);
	} else {
		engine.setPaused(true);
		setStep(0);
	}
	raf = requestAnimationFrame(tick);

	/** Static states for --preview screenshots. */
	function applyPreview({ step, data = {} }) {
		const index = STEPS.findIndex((s) => s.id === step);
		center = data.center ?? null;
		range = data.range ?? null;
		Object.assign(peaks, data.peaks ?? {});
		if (step === "done") computeResults();
		setStep(Math.max(0, index));
		if (step === "center") {
			holdRing.style.setProperty("--p", String(data.progress ?? 0.62));
			setText(holdValue, `${Math.round((data.progress ?? 0.62) * 100)}%`);
		}
		if (step === "range" && range) {
			attitude.update(data.pose ?? { yaw: -18, pitch: 6, roll: 3 });
			attitude.setRange({ yawMin: -range.yawMax, yawMax: -range.yawMin, pitchMin: range.pitchMin, pitchMax: range.pitchMax, pitchNow: data.pose?.pitch ?? 6 });
			for (const d of data.dirs ?? ["LEFT", "RIGHT", "UP"]) dirChips[d].classList.add("is-done");
			setText(rangeTimer, "7S LEFT");
		}
		if (step === "gestures") {
			taskIndex = data.taskIndex ?? 2;
			setText(instruction, GESTURE_TASKS[taskIndex].name + ".");
			measureRows.forEach((row, i) => {
				if (i < taskIndex) {
					row.el.classList.add("is-done");
					setText(row.state, "MEASURED");
				}
			});
			const row = measureRows[taskIndex];
			row.el.classList.add("is-current");
			setText(row.state, "3S");
			row.vals.replaceChildren(
				h("span", {}, "NOW ", h("b", {}, "0.41")), h("span", {}, "PEAK ", h("b", {}, "0.48")),
				h("span", {}, "THRESHOLD ", h("b", {}, "0.25")), h("span", {}, "REST ", h("b", {}, "0.04")),
			);
		}
	}

	return { close };
}
