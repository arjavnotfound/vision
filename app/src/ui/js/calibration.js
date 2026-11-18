// Calibration (UX spec 4). Feels like measuring: three steps that move on only when the
// measurement is done, never on a timer.
//   1. Centre: "Look at the middle of the screen." Holds once a steady face is seen for 1 s.
//   2. Range:  "Turn your head left… right… up… down." A live bar and degrees per direction;
//              each locks with a tick once held at its maximum for 0.5 s. When all four are
//              locked and the person looks back at the middle, it moves on. "I need more
//              time" stops that.
//   3. Gestures: wink left, wink right, open mouth, raise brows. Each one moves on once it
//              has been done clearly and released. One the person can't make moves on after
//              GESTURE_MAX_MS, because the frozen cursor can't reach a Skip button; "not
//              measured" is itself the result the adaptive control plan needs.
//   4. Summary: one sentence in degrees, a big "Use this", "Measure again" below it, and the
//              raw numbers behind "Details".
// The cursor is frozen during steps 1–2 so turning the head does not sweep it across the
// desktop; it comes back for the summary, which is accepted by dwelling or a wink.
// Nothing is saved without a face in view. Results go only into existing settings
// (head-tilt offsets and ranges, point-tracking speed, gesture thresholds). With
// `adaptive`, the measured gestures also pick the controls (control-map.js planControls),
// which are applied on "Use this" and handed to onPlan.
//
// mount(el, { engine, toast, onClose(applied), onDetails, preview, profiles, extraTop, adaptive, onPlan })

import { h, setText, signed } from "./dom.js";
import { markSvg } from "./mark-svg.js";
import { createViewfinder } from "./viewfinder.js";
import {
	summarizeCenter, poseSettings, suggestSensitivityFactor, createRangeTracker, rangeDegrees, rangeSentence,
	suggestThresholds, combineEyeSuggestions, thresholdSettings,
} from "./calibration-math.js";
import { assessGesture, planControls, controlSettings, describePlan } from "./control-map.js";
import { speak } from "./speech.js";
import { ensureBuildDStyles } from "./d-style.js";

export const CENTER_HOLD_MS = 1000;
const BACK_TO_CENTRE_MS = 500;
const BACK_TO_CENTRE_DEG = 4;
const STEPS = ["Centre", "Range", "Gestures", "Your range"];
const SUMMARY = 3;
export const GESTURE_MAX_MS = 6000;
// The smallest clear change from rest per kind (suggestThresholds refuses less than this).
const CLEAR_SPAN = { eye: 0.06, mouth: 0.12, brow: 0.03 };
// `other`: for winks the other eye is watched too, so a "wink" that closes both eyes is caught.
export const GESTURE_TASKS = [
	{ id: "leftWink", name: "Wink your left eye", kind: "eye", read: (g) => g.leftEye?.ratio, other: (g) => g.rightEye?.ratio, rest: "leftEye", extreme: "min" },
	{ id: "rightWink", name: "Wink your right eye", kind: "eye", read: (g) => g.rightEye?.ratio, other: (g) => g.leftEye?.ratio, rest: "rightEye", extreme: "min" },
	{ id: "mouth", name: "Open your mouth wide", kind: "mouth", read: (g) => g.mouth?.ratio, rest: "mouth", extreme: "max" },
	{ id: "brow", name: "Raise your eyebrows", kind: "brow", read: (g) => g.brow?.ratio, rest: "brow", extreme: "max" },
];

/** Pure: has this gesture been made clearly and then released? */
export function gestureDone(task, neutral, peak, value) {
	if (![neutral, peak, value].every(Number.isFinite)) return false;
	const span = task.extreme === "min" ? neutral - peak : peak - neutral;
	if (span < CLEAR_SPAN[task.kind]) return false;
	const back = task.extreme === "min" ? neutral - value : value - neutral;
	return back < span * 0.4;
}

/** Pure: thresholds and the adaptive control plan from the gesture peaks. */
export function gestureResults(center, peaks, otherPeaks) {
	const c = center ?? {};
	const eye = combineEyeSuggestions(suggestThresholds("eye", c.leftEye, peaks.leftWink), suggestThresholds("eye", c.rightEye, peaks.rightWink));
	const mouth = suggestThresholds("mouth", c.mouth, peaks.mouth);
	const brow = suggestThresholds("brow", c.brow, peaks.brow);
	const assessment = {
		leftWink: assessGesture("eye", { neutral: c.leftEye, peak: peaks.leftWink, otherNeutral: c.rightEye, otherPeak: otherPeaks.leftWink }),
		rightWink: assessGesture("eye", { neutral: c.rightEye, peak: peaks.rightWink, otherNeutral: c.leftEye, otherPeak: otherPeaks.rightWink }),
		mouth: assessGesture("mouth", { neutral: c.mouth, peak: peaks.mouth }),
		brow: assessGesture("brow", { neutral: c.brow, peak: peaks.brow }),
	};
	return { thresholds: thresholdSettings({ eye, mouth, brow }), assessment, plan: planControls(assessment) };
}
const DIRS = [["left", "Left", 45], ["right", "Right", 45], ["up", "Up", 30], ["down", "Down", 30]];

export function mount(el, { engine, toast, onClose, onDetails, preview = null, profiles = null, extraTop = null, adaptive = false, onPlan = null } = {}) {
	ensureBuildDStyles();
	const wasPaused = engine.isPaused();
	let step = 0;
	let raf = 0;
	let closed = false;
	let refusalSpoken = false;

	// --- measurement state
	let centerSamples = [];
	let centerProgress = 0;
	let center = null;
	let tracker = null;
	let range = null;
	let moreTime = false;
	let centreSince = null;
	let taskIndex = 0;
	let taskStart = 0;
	let peaks = {};
	let otherPeaks = {};
	const say = (text) => { if (!preview) speak(text); };

	// --- layout
	const chips = STEPS.map((label, i) => h("span", { class: "steps__item d-step" }, `${i + 1} · ${label}`));
	const vfHost = h("div");
	const instruction = h("div", { class: "instruction" }, "");
	const sub = h("div", { class: "instruction__sub" }, "");
	const widget = h("div", { class: "d-widget" });
	const foot = h("div", { class: "screen__foot" });
	const screen = h("div", { class: "screen d-screen", role: "dialog", "aria-modal": "true", "aria-label": "Calibrate" },
		h("div", { class: "screen__top" },
			h("div", { class: "brand" }, markSvg(24), h("span", { class: "brand__word" }, "VISION"), h("span", { class: "brand__rule" }), h("span", { class: "brand__sub" }, "Calibrate")),
			h("div", { class: "steps" }, ...chips),
			h("div", { class: "titlebar__spacer" }),
			extraTop,
			h("button", { class: "btn btn--ghost", "data-dwell": true, onclick: () => close(false) }, "Cancel"),
		),
		h("div", { class: "screen__body" }, h("div", { class: "panel screen__vf" }, vfHost), h("div", { class: "screen__side" }, instruction, sub, widget)),
		foot,
	);
	el.append(screen);
	const viewfinder = createViewfinder(vfHost, { engine, readouts: false, guide: true, hint: true, pausedMessage: false });

	// --- step widgets
	const holdRing = h("div", { class: "hold-ring" });
	const holdValue = h("span", { class: "d-hold-text" }, "Hold still");
	const holdWrap = h("div", { class: "hold-ring-wrap" }, holdRing, holdValue);

	const rangeRows = Object.fromEntries(DIRS.map(([id, label, scale]) => {
		const fill = h("i", { class: "range-row__fill" });
		const best = h("i", { class: "range-row__best" });
		const value = h("span", { class: "range-row__deg" }, "0°");
		const tick = h("span", { class: "range-row__tick", "aria-hidden": "true" }, "✓");
		const row = h("div", { class: "range-row", dataset: { dir: id } },
			h("span", { class: "range-row__name" }, label),
			h("div", { class: "range-row__bar" }, fill, best),
			value, tick);
		return [id, { row, fill, best, value, scale }];
	}));
	const gestureRows = GESTURE_TASKS.map((task) => {
		const state = h("span", { class: "range-row__deg" }, "");
		const row = h("div", { class: "range-row", dataset: { gesture: task.id } },
			h("span", { class: "range-row__name" }, task.name),
			state,
			h("span", { class: "range-row__tick", "aria-hidden": "true" }, "✓"));
		return { row, state, measured: false };
	});

	function showTask() {
		gestureRows.forEach((r, i) => {
			r.row.classList.toggle("is-current", i === taskIndex);
			r.row.classList.toggle("is-locked", i < taskIndex && r.measured);
			if (i > taskIndex) setText(r.state, "");
		});
		const task = GESTURE_TASKS[taskIndex];
		if (!task) return;
		setText(instruction, `${task.name}.`);
		setText(gestureRows[taskIndex].state, "Now");
		say(`${task.name}.`);
	}

	function nextTask(measured) {
		const r = gestureRows[taskIndex];
		if (r) {
			r.measured = measured;
			setText(r.state, measured ? "Done" : "Skipped");
		}
		taskIndex++;
		taskStart = performance.now();
		if (taskIndex >= GESTURE_TASKS.length) setStep(SUMMARY);
		else showTask();
	}

	const moreTimeBtn = h("button", { class: "btn", "data-dwell": true, onclick: () => setMoreTime(!moreTime) }, "I need more time");
	const rangeHint = h("span", { class: "d-foot-note" }, "");

	function setMoreTime(on) {
		moreTime = on;
		setText(moreTimeBtn, on ? "Move on by itself" : "I need more time");
		setText(rangeHint, on ? "Take your time. Choose Done when you have turned each way." : "When each direction has a tick, look back at the middle.");
	}

	function paintRange(state) {
		for (const [id, r] of Object.entries(rangeRows)) {
			const s = state[id];
			r.fill.style.width = `${Math.min(100, (s.now / r.scale) * 100)}%`;
			r.best.style.left = `${Math.min(100, (s.best / r.scale) * 100)}%`;
			setText(r.value, s.best >= 1 ? `${Math.round(s.now)}° … ${Math.round(s.best)}°` : "0°");
			r.row.classList.toggle("is-locked", s.locked);
		}
	}

	function setStep(index) {
		step = index;
		chips.forEach((chip, i) => {
			chip.classList.toggle("is-current", i === index);
			chip.classList.toggle("is-done", i < index);
		});
		widget.replaceChildren();
		foot.replaceChildren();
		instruction.hidden = false;
		sub.hidden = false;
		sub.classList.remove("is-warning");
		if (index === 0) {
			setText(instruction, "Look at the middle of the screen.");
			setText(sub, "Hold still for a moment. This becomes the centre of your screen.");
			say("Look at the middle of the screen and hold still.");
			widget.append(holdWrap);
			foot.append(h("span", { class: "d-foot-note" }, "The cursor stays still while you calibrate."));
		} else if (index === 1) {
			setText(instruction, "Turn your head left… right… up… down.");
			setText(sub, "Only as far as feels easy. Hold each turn for a moment until it gets a tick.");
			say("Now turn your head left, right, up and down, only as far as feels easy. Hold each turn for a moment.");
			tracker = createRangeTracker(center ?? { yaw: 0, pitch: 0 });
			paintRange(tracker.state());
			widget.append(h("div", { class: "range-list" }, ...Object.values(rangeRows).map((r) => r.row)));
			setMoreTime(false);
			foot.append(rangeHint, h("div", { class: "session__spacer" }), moreTimeBtn,
				h("button", { class: "btn", "data-dwell": true, onclick: () => finishRange() }, "Done"));
		} else if (index === 2) {
			taskIndex = 0;
			taskStart = performance.now();
			for (const r of gestureRows) r.measured = false;
			setText(sub, "Do each one once, clearly. VISION learns how strong each one is for you.");
			say("Now some face gestures. Do each one once.");
			widget.append(h("div", { class: "range-list" }, ...gestureRows.map((r) => r.row)));
			foot.append(h("span", { class: "d-foot-note" }, "If you can't do one, wait and it moves on."), h("div", { class: "session__spacer" }),
				h("button", { class: "btn", "data-dwell": true, onclick: () => nextTask(false) }, "Skip this one"));
			showTask();
		} else {
			engine.setPaused(wasPaused); // give the cursor back so the summary can be accepted
			renderSummary();
		}
	}

	function finishRange() {
		range = tracker ? tracker.range() : null;
		setStep(2);
	}

	function results() {
		const c = center ?? { yaw: NaN, pitch: NaN };
		const r = range ?? { yawMin: NaN, yawMax: NaN, pitchMin: NaN, pitchMax: NaN };
		return { pose: center ? poseSettings(c, r) : {}, sensitivityFactor: range ? suggestSensitivityFactor(r) : 1, ...gestureResults(center, peaks, otherPeaks) };
	}

	function renderSummary() {
		const deg = center && range ? rangeDegrees(center, range) : null;
		const sentence = deg ? rangeSentence(deg) : "VISION has your centre, but not your range yet.";
		instruction.hidden = true;
		sub.hidden = true;
		say(sentence);
		const details = h("div", { class: "d-details", hidden: true });
		const res = results();
		details.append(
			h("div", { class: "d-details__row" }, h("span", {}, "Centre"), h("b", {}, center ? `${signed(-center.yaw, 1)}° across, ${signed(center.pitch, 1)}° up` : "–")),
			h("div", { class: "d-details__row" }, h("span", {}, "Speed change"), h("b", {}, `×${res.sensitivityFactor.toFixed(2)}`)),
			h("div", { class: "d-details__row" }, h("span", {}, "Tilt settings"), h("b", {}, Object.keys(res.pose).length ? `${Object.keys(res.pose).length} updated` : "kept")),
			h("div", { class: "d-details__row" }, h("span", {}, "Gesture thresholds"), h("b", {}, Object.keys(res.thresholds).length ? `${Object.keys(res.thresholds).length} updated` : "kept")),
			onDetails ? h("button", { class: "btn", "data-dwell": true, onclick: () => { close(false); onDetails(); } }, "Open Diagnostics") : null,
		);
		const detailsBtn = h("button", { class: "btn btn--ghost", "data-dwell": true, "aria-expanded": "false", onclick: () => {
			details.hidden = !details.hidden;
			detailsBtn.setAttribute("aria-expanded", String(!details.hidden));
		} }, "Details");
		const controls = adaptive ? describePlan(res.plan).filter((row) => row.action === "leftClick" || row.action === "rightClick") : [];
		const controlsLine = controls.map((row) => `${row.label}: ${row.how.replace(/[“”]/g, "")}.`).join(" ");
		if (controls.length) say(`Your controls. ${controlsLine}`);
		widget.append(
			h("p", { class: "d-sentence" }, sentence),
			controls.length ? h("p", { class: "instruction__sub" }, controlsLine) : null,
			h("button", { class: "btn btn--ember d-big", "data-dwell": true, onclick: () => apply() }, "Use this"),
			h("div", { class: "d-separator" }),
			h("button", { class: "btn d-wide", "data-dwell": true, onclick: () => restart() }, "Measure again"),
			details,
		);
		foot.append(detailsBtn);
	}

	function refuse() {
		const text = "VISION couldn't see your face, so nothing was saved.";
		instruction.hidden = true;
		sub.hidden = true;
		foot.replaceChildren();
		widget.replaceChildren(
			h("p", { class: "d-sentence" }, text),
			h("button", { class: "btn btn--ember d-big", "data-dwell": true, onclick: () => restart() }, "Try again"),
		);
		if (!refusalSpoken) {
			refusalSpoken = true;
			say(`${text} Look at the camera, then try again.`);
		}
	}

	function apply() {
		// Never save measurements taken without a face in view (they would be noise).
		if (!engine.getState().faceFound) {
			refuse();
			return false;
		}
		const st = engine.settings;
		const res = results();
		for (const [key, value] of Object.entries({ ...res.pose, ...res.thresholds })) {
			if (st.has(key)) st.set(key, value);
		}
		if (adaptive) {
			for (const [key, value] of Object.entries(controlSettings(res.plan))) {
				if (st.has(key)) st.set(key, value);
			}
			onPlan?.(res.plan, res.assessment);
		}
		if (res.sensitivityFactor !== 1) {
			for (const key of ["headTrackingSensitivityX", "headTrackingSensitivityY"]) {
				if (st.has(key)) st.set(key, Math.round(Math.min(0.1, st.get(key) * res.sensitivityFactor) * 10000) / 10000);
			}
		}
		profiles?.saveActive?.();
		toast?.("Calibration saved.");
		close(true);
		return true;
	}

	function restart() {
		centerSamples = [];
		centerProgress = 0;
		center = null;
		tracker = null;
		range = null;
		centreSince = null;
		peaks = {};
		otherPeaks = {};
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
		const g = state.gestures || {};
		const sample = { yaw: state.pose.yaw, pitch: state.pose.pitch, leftEye: g.leftEye?.ratio, rightEye: g.rightEye?.ratio, mouth: g.mouth?.ratio, brow: g.brow?.ratio };

		if (step === 0) {
			const recent = centerSamples.slice(-20);
			const meanYaw = recent.reduce((a, s) => a + s.yaw, 0) / Math.max(1, recent.length);
			const meanPitch = recent.reduce((a, s) => a + s.pitch, 0) / Math.max(1, recent.length);
			const steady = state.faceFound && (recent.length < 5 || (Math.abs(sample.yaw - meanYaw) < 4 && Math.abs(sample.pitch - meanPitch) < 4));
			if (steady) {
				centerSamples.push(sample);
				centerProgress = Math.min(1, centerProgress + dt / CENTER_HOLD_MS);
			} else {
				centerProgress = Math.max(0, centerProgress - dt / CENTER_HOLD_MS);
				if (centerProgress === 0) centerSamples = [];
			}
			holdRing.style.setProperty("--p", centerProgress.toFixed(3));
			setText(holdValue, state.faceFound ? "Hold still" : "Look at the camera");
			if (centerProgress >= 1) {
				center = summarizeCenter(centerSamples.slice(-60));
				setStep(1);
			}
		} else if (step === 1 && tracker) {
			if (!state.faceFound) return;
			const s = tracker.push(state.pose, now);
			paintRange(s);
			const atCentre = Object.values(s).every((d) => d.now < BACK_TO_CENTRE_DEG);
			centreSince = tracker.allLocked() && atCentre ? (centreSince ?? now) : null;
			if (!moreTime && centreSince !== null && now - centreSince >= BACK_TO_CENTRE_MS) finishRange();
		} else if (step === 2) {
			const task = GESTURE_TASKS[taskIndex];
			if (!task) return;
			const value = task.read(g);
			if (state.faceFound && Number.isFinite(value)) {
				const prev = peaks[task.id];
				peaks[task.id] = !Number.isFinite(prev) ? value : task.extreme === "min" ? Math.min(prev, value) : Math.max(prev, value);
				const other = task.other?.(g);
				if (Number.isFinite(other)) otherPeaks[task.id] = Math.min(otherPeaks[task.id] ?? other, other);
			}
			if (gestureDone(task, center?.[task.rest], peaks[task.id], value)) nextTask(true);
			else if (now - taskStart > GESTURE_MAX_MS) nextTask(false);
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

	/** Static states for screenshots: step "center" | "range" | "done" | "refused". */
	function applyPreview({ step: name, data = {} }) {
		center = data.center ?? null;
		range = data.range ?? null;
		if (name === "center") {
			setStep(0);
			holdRing.style.setProperty("--p", String(data.progress ?? 0.62));
		} else if (name === "gestures") {
			setStep(2);
			taskIndex = data.taskIndex ?? 2;
			for (let i = 0; i < taskIndex; i++) {
				gestureRows[i].measured = true;
				setText(gestureRows[i].state, "Done");
			}
			showTask();
		} else if (name === "range") {
			setStep(1);
			const locked = data.locked ?? ["left", "right", "up"];
			const deg = center && range ? rangeDegrees(center, range) : { left: 0, right: 0, up: 0, down: 0 };
			const live = data.now ?? { left: 0, right: 0, up: 0, down: 9 };
			paintRange(Object.fromEntries(DIRS.map(([id]) => [id, { now: live[id] ?? 0, best: locked.includes(id) ? deg[id] : live[id] ?? 0, locked: locked.includes(id) }])));
		} else {
			setStep(SUMMARY);
			if (name === "refused") refuse();
		}
	}

	if (preview) applyPreview(preview);
	else {
		engine.setPaused(true);
		setStep(0);
	}
	raf = requestAnimationFrame(tick);
	return { close, apply };
}

/** Older entry point used by main.js until the wiring pass: same screen on `layer`. */
export function openCalibration(options) {
	return mount(options.layer, options);
}
