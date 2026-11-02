// VISION Face Control — new UI entry point.
// Talks to the tracking engine ONLY through its public API (Vision.initEngine), or to the
// mock engine in --preview mode.

import { h, setText } from "./dom.js";
import { createDwell } from "./dwell.js";
import { createViewfinder } from "./viewfinder.js";
import { createAttitude } from "./attitude.js";
import { createMeters } from "./meters.js";
import { createControls } from "./controls.js";
import { createProfiles } from "./profiles.js";
import { openSettings, openProfiles, openAbout, openConfirm } from "./sheets.js";
import { openCalibration } from "./calibration.js";
import { openOnboarding } from "./onboarding.js";
import { createHost } from "./host.js";
import { clickingModeLabel } from "./labels.js";
import { Mark, markStateFor } from "./mark.js";
import { openStartScreen, openTryIt } from "./kiosk.js";
import { detectMisfire, controlSettings, createBrowClick, choosePlan, DEFAULT_PLAN, INPUT_LABELS, ACTION_LABELS } from "./control-map.js";
import { speak, setSpeechMuted } from "./speech.js";
import { createRecoveryMonitor } from "./recovery.js";

const params = new URLSearchParams(location.search);
const isPreview = params.has("preview");
const sceneName = params.get("scene") || "tracking";
// Started from VISION.bat: Start screen, adaptive calibration, try-it, voice link.
const isKiosk = params.has("kiosk") && !isPreview;
if (params.has("quiet")) setSpeechMuted(true);

const ENGINE_ROOT = "../../node_modules/vision-hft";
const ENGINE_SCRIPTS = [
	"lib/no-eval.js",
	"lib/clmtrackr.js",
	"lib/face_mesh/face_mesh.js",
	"lib/face-landmarks-detection.min.js",
	"lib/OneEuroFilter.js",
	"vision.js",
];

function loadScript(src) {
	return new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = src;
		script.onload = resolve;
		script.onerror = () => reject(new Error(`Failed to load ${src}`));
		document.head.append(script);
	});
}

/* global Vision */
const VisionGlobal = () => Vision;

async function bootRealEngine(host) {
	for (const file of ENGINE_SCRIPTS) {
		await loadScript(`${ENGINE_ROOT}/${file}`);
	}
	// The engine reads the language from localStorage at start-up (as in the legacy window).
	try {
		const options = await host.getOptions();
		localStorage.setItem("vision-settings", JSON.stringify(options));
	} catch (error) {
		console.error("Could not read settings from the main process:", error);
	}
	// vision.js is a classic script with a top-level `const Vision` (a global binding, not window.Vision).
	const Vision = typeof globalThis.Vision !== "undefined" ? globalThis.Vision : VisionGlobal();
	Vision.dependenciesRoot = ENGINE_ROOT;
	const modules = await Vision.loadCoreModules();
	// --synthetic-face (QA): scripted face instead of face mesh; tracking still starts paused.
	const engine = Vision.initEngine(params.has("synthetic") ? { syntheticFace: modules.createSyntheticFace() } : {});
	await engine.ready();
	return engine;
}

async function boot() {
	const host = createHost({ preview: isPreview });
	let engine;
	if (isPreview) {
		const { createMockEngine } = await import("./mock-engine.js");
		engine = createMockEngine(sceneName);
	} else {
		engine = await bootRealEngine(host);
	}
	// Seam for later integrations (and the FPS benchmark): the public engine API only.
	window.visionEngine = engine;

	const st = engine.settings;
	const layer = document.getElementById("layer");
	const toasts = document.getElementById("toasts");

	// ---- theme
	const theme = () => document.documentElement.dataset.theme;
	const setTheme = (name, persist = true) => {
		document.documentElement.dataset.theme = name === "paper" ? "paper" : "ember";
		if (persist && st.has("uiTheme")) st.set("uiTheme", theme());
	};
	setTheme(params.get("theme") || st.get("uiTheme") || "ember", false);

	// ---- toasts
	function toast(message) {
		const el = h("div", { class: "toast" }, message);
		toasts.append(el);
		setTimeout(() => el.remove(), 4200);
	}
	engine.on("toast", ({ message }) => toast(message));
	let lastErrorToast = "";
	engine.on("error", ({ message }) => {
		if (message && message !== lastErrorToast) {
			lastErrorToast = message;
			toast(message);
			setTimeout(() => { lastErrorToast = ""; }, 8000);
		}
	});

	// ---- dwell
	let latestState = engine.getState();
	const dwell = createDwell({
		ring: document.getElementById("dwell-ring"),
		getDwellTime: () => st.get("dwellTime") ?? 800,
		// Off while paused (the cursor then belongs to a physical mouse) and in Dwell Click
		// mode (the desktop overlay already dwell-clicks everything, including this window).
		isEnabled: () => isPreview || (!latestState.paused && latestState.clickingMode !== "dwell" && latestState.status === "tracking"),
	});

	// ---- instruments
	const viewfinder = createViewfinder(document.getElementById("main-viewfinder"), { engine });
	const attitude = createAttitude(document.getElementById("attitude"));
	const meters = createMeters(document.getElementById("meters"));
	engine.on("gesture", ({ gesture, action, phase }) => {
		if (phase === "start" || phase === undefined) meters.fire(gesture, action);
	});
	// Click toast at the top of the viewfinder whenever a click gesture fires.
	const CLICK_TOAST = { left: "Left click", right: "Right click", middle: "Middle click" };
	engine.on("click", ({ button, down }) => {
		// (~1.2 s; held longer in --preview so screenshots can catch it)
		if (down && CLICK_TOAST[button]) viewfinder.toast(CLICK_TOAST[button], isPreview ? 5000 : 1200);
	});

	const profiles = createProfiles(st);
	let saveTimer = 0;
	const autosaveProfile = () => {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => profiles.saveActive(), 800);
	};
	const controls = createControls({
		steppersEl: document.getElementById("steppers"),
		togglesEl: document.getElementById("toggles"),
		settings: st,
		onChange: autosaveProfile,
	});
	const refreshLabels = () => {
		const name = profiles.active();
		setText(document.getElementById("profile-name"), name);
		setText(document.getElementById("profile-label"), `PROFILE · ${name.toUpperCase()}`);
		setText(document.getElementById("mode-label"), clickingModeLabel(st.get("clickingMode")).toUpperCase());
	};
	engine.on("settings", ({ key }) => {
		if (key === "profiles") return;
		controls.refresh();
		refreshLabels();
		if (key === "uiTheme" && st.get("uiTheme") !== theme()) setTheme(st.get("uiTheme"), false);
	});
	refreshLabels();

	// ---- title bar
	const pill = document.querySelector(".status-pill");
	const statusWord = document.getElementById("status-word");
	const fpsValue = document.getElementById("fps-value");
	const pauseBtn = document.getElementById("pause-toggle");
	const pauseLabel = document.getElementById("pause-label");
	const hint = document.getElementById("session-hint");
	pauseBtn.addEventListener("click", () => engine.togglePaused());

	for (const btn of document.querySelectorAll("[data-window]")) {
		btn.addEventListener("click", () => {
			const action = btn.dataset.window;
			if (action === "close") {
				openConfirm(layer, {
					title: "Quit VISION?",
					text: "Head control stops and any held mouse button is released. You can also hide VISION to the tray and keep tracking.",
					confirmLabel: "Quit",
					danger: true,
					onConfirm: () => host.windowControl("quit"),
					secondary: { label: "Hide to tray", onClick: () => host.windowControl("hide") },
				});
			} else {
				host.windowControl(action);
			}
		});
	}

	// ---- session strip
	let calibration = null;
	let afterCalibration = null;
	const startCalibration = (preview = null, { adaptive = isKiosk } = {}) => {
		if (calibration) return;
		calibration = openCalibration({
			layer, engine, profiles, toast, preview, adaptive,
			onPlan: (plan) => saveControlMap(plan),
			onClose: (applied) => {
				calibration = null;
				controls.refresh();
				refreshLabels();
				const then = afterCalibration;
				afterCalibration = null;
				then?.(applied);
			},
		});
	};

	// ---- adaptive control map (stored in the settings file next to the engine settings)
	let controlMap = null;
	try {
		controlMap = (await host.getOptions())?.globalSettings?.controlMap ?? null;
	} catch (_error) {
		controlMap = null;
	}
	function saveControlMap(plan) {
		controlMap = plan;
		window.electronAPI?.setOptions?.({ globalSettings: { controlMap: plan } });
		autosaveProfile();
	}
	// The person's own choice from Settings: engine settings + the stored map together.
	function applyPlan(plan) {
		for (const [key, value] of Object.entries(controlSettings(plan))) {
			if (st.has(key)) st.set(key, value);
		}
		saveControlMap(plan);
		controls.refresh();
		refreshLabels();
	}
	// Raised brows as right click (when calibration moved right click there): the brows
	// must be HELD for 0.4 s, so a surprised face or talking does not click.
	const browClick = createBrowClick();
	engine.on("state", (state) => {
		const raised = Boolean(state?.gestures?.brow?.raised);
		if (controlMap?.rightClick !== "brow" || state?.paused || calibration) {
			browClick.reset();
			return;
		}
		if (browClick.step(raised, performance.now())) {
			window.electronAPI?.mappedClick?.("right");
			viewfinder.toast("Right click", 1200);
		}
	});
	// A gesture that keeps firing by accident, or never fires: offer to switch it.
	const gestureClicks = [];
	let trackingSince = 0;
	let lastOffer = 0;
	engine.on("click", ({ button, down, source }) => {
		if (down && source === "gesture") {
			gestureClicks.push({ button, t: performance.now() });
			while (gestureClicks.length > 40) gestureClicks.shift();
		}
	});
	function offerSwitch(offer) {
		lastOffer = performance.now();
		const action = ACTION_LABELS[offer.action];
		const to = INPUT_LABELS[offer.to].toLowerCase();
		const text = offer.kind === "misfire"
			? `${action} seems to be firing by accident. Switch it to: ${to}?`
			: `${action} has not been used for a while. Switch it to: ${to}?`;
		speak(text);
		host.windowControl("show");
		openConfirm(layer, {
			title: "Switch a control?",
			text,
			confirmLabel: "Yes, switch",
			onConfirm: () => applySwitch(offer),
			secondary: { label: "No, keep it", onClick: () => { } },
		});
	}
	function applySwitch(offer) {
		// Any allowed choice (also back to a wink), kept consistent by choosePlan.
		const next = choosePlan(controlMap ?? { ...DEFAULT_PLAN, clickingMode: st.get("clickingMode") }, offer.action, offer.to);
		for (const [key, value] of Object.entries(controlSettings(next))) {
			if (st.has(key)) st.set(key, value);
		}
		saveControlMap(next);
		controls.refresh();
		refreshLabels();
		speak(`Done. ${ACTION_LABELS[offer.action]} is now: ${INPUT_LABELS[offer.to].toLowerCase()}.`);
	}
	if (isKiosk) {
		setInterval(() => {
			const now = performance.now();
			if (latestState.status !== "tracking") {
				trackingSince = 0;
				return;
			}
			trackingSince ||= now;
			if (calibration || startScreen?.isOpen() || tryIt || now - lastOffer < 120000) return;
			const offer = detectMisfire({ events: gestureClicks, now, trackingSince, plan: controlMap });
			if (offer) {
				gestureClicks.length = 0;
				trackingSince = now;
				offerSwitch(offer);
			}
		}, 2000);
	}
	document.getElementById("calibrate-btn").addEventListener("click", () => startCalibration());

	// ---- one-app flow: Start -> calibration + your controls -> try it -> free use
	let startScreen = null;
	let tryIt = null;
	let busState = null;
	const baseline = isKiosk ? { ...st.getAll() } : null;
	const BASELINE_KEYS = ["clickingMode", "mouthTiltScroll", "eyebrowRaiseOpensKeyboard", "headTrackingSensitivityX", "headTrackingSensitivityY",
		"eyeThresholdHigh", "eyeThresholdLow", "mouthThresholdHigh", "mouthThresholdLow", "browThresholdHigh", "browThresholdLow"];
	function closeLayers() {
		afterCalibration = null;
		calibration?.close?.(false);
		calibration = null;
		tryIt?.close();
		tryIt = null;
		startScreen?.close();
		startScreen = null;
		layer.replaceChildren();
	}
	function showStart() {
		afterCalibration = null;
		closeLayers();
		// Next person: start from the same settings every time (calibration adjusts them).
		if (baseline) {
			for (const key of BASELINE_KEYS) {
				if (key in baseline && st.has(key) && st.get(key) !== baseline[key]) st.set(key, baseline[key]);
			}
		}
		saveControlMap(null);
		// Hands-free resume: while paused the cursor cannot reach the orb, so closing both
		// eyes for 2 s (an existing setting) must be able to resume tracking.
		if (st.has("closeEyesToToggle") && !st.get("closeEyesToToggle")) st.set("closeEyesToToggle", true);
		host.windowControl("show");
		startScreen = openStartScreen({
			layer, engine,
			onStart: () => {
				startScreen = null;
				afterCalibration = (applied) => {
					if (!applied) {
						showStart();
						return;
					}
					tryIt = openTryIt({
						layer, plan: controlMap,
						onDone: () => {
							tryIt = null;
							// Free use: get out of the way; tracking keeps running.
							host.windowControl("minimize");
						},
					});
				};
				startCalibration(null, { adaptive: true });
			},
		});
		if (busState) startScreen.setBus(busState);
	}

	// ---- link to the voice assistant
	const voicePill = h("div", { class: "voice-pill", hidden: true, role: "status" }, "VOICE ON · MOUTH OFF");
	document.querySelector(".status-pill")?.after(voicePill);
	window.electronAPI?.onBusState?.((state) => {
		busState = state;
		const live = Boolean(state?.assistant?.live);
		voicePill.hidden = !live;
		startScreen?.setBus(state);
	});
	window.electronAPI?.requestBusState?.();

	const SPEED_KEYS = ["headTrackingSensitivityX", "headTrackingSensitivityY"];
	const CLICK_MODES = { wink: "blink", dwell: "dwell", mouth: "open-mouth-simple" };
	function handleBusCommand(cmd, value) {
		if (cmd === "pause") {
			engine.setPaused(true);
			return { done: "paused" };
		}
		if (cmd === "resume") {
			engine.setPaused(false);
			return { done: "resumed" };
		}
		if (cmd === "toggle-pause") {
			engine.togglePaused();
			return { done: engine.isPaused() ? "paused" : "resumed" };
		}
		if (cmd === "recalibrate") {
			closeLayers();
			startCalibration(null, { adaptive: true });
			return { done: "calibrating" };
		}
		if (cmd === "reset") {
			showStart();
			return { done: "start screen" };
		}
		if (cmd === "speed") {
			const factor = value === "faster" ? 1.25 : value === "slower" ? 0.8 : NaN;
			if (!Number.isFinite(factor)) return { done: "none", error: "say faster or slower" };
			for (const key of SPEED_KEYS) {
				const next = Math.round(Math.min(0.1, Math.max(0.001, st.get(key) * factor)) * 10000) / 10000;
				st.set(key, next);
			}
			autosaveProfile();
			return { done: `cursor ${value}`, sensitivity: st.get(SPEED_KEYS[0]) };
		}
		if (cmd === "click-mode") {
			const mode = CLICK_MODES[String(value).toLowerCase()];
			if (!mode) return { done: "none", error: "use wink, dwell or mouth" };
			st.set("clickingMode", mode);
			const base = controlMap ?? { rightClick: "rightWink", scroll: "mouth", keyboard: "brow" };
			// Asking for a mode by name means its default inputs: wink mode = both winks.
			const rightClick = mode === "blink" ? "rightWink" : base.rightClick === "rightWink" ? "voice" : base.rightClick;
			saveControlMap({ ...base, clickingMode: mode, leftClick: mode === "blink" ? "leftWink" : mode === "dwell" ? "dwell" : "mouth", rightClick, keyboard: rightClick === "brow" ? "button" : "brow" });
			if (st.has("eyebrowRaiseOpensKeyboard")) st.set("eyebrowRaiseOpensKeyboard", rightClick !== "brow");
			controls.refresh();
			refreshLabels();
			return { done: `click mode ${value}` };
		}
		if (cmd === "remap" && value && typeof value === "object") {
			try {
				applySwitch({ action: value.action, to: value.to });
			} catch (error) {
				return { done: "none", error: String(error?.message ?? error) };
			}
			return { done: "remapped", controlMap };
		}
		if (cmd === "controls") {
			return { done: "controls", controlMap, clickingMode: st.get("clickingMode") };
		}
		return { done: cmd };
	}
	document.getElementById("profile-btn").addEventListener("click", () => openProfiles(layer, { profiles, onChanged: () => { controls.refresh(); refreshLabels(); } }));
	document.getElementById("keyboard-btn").addEventListener("click", () => engine.openOnScreenKeyboard());
	document.getElementById("settings-btn").addEventListener("click", () => openSettings(layer, {
		engine, host, theme, onThemeChange: (name) => setTheme(name), onChanged: () => { controls.refresh(); refreshLabels(); autosaveProfile(); },
		controlMap: { get: () => controlMap, set: applyPlan },
	}));
	document.getElementById("about-btn").addEventListener("click", async () => openAbout(layer, { version: await host.getVersion() }));
	host.onCommand?.((command) => {
		if (command && typeof command === "object" && command.type === "bus") {
			let result;
			try {
				result = handleBusCommand(command.cmd, command.value);
			} catch (error) {
				result = { done: "none", error: String(error?.message ?? error) };
			}
			window.electronAPI?.replyBusCommand?.(command.id, result);
			return;
		}
		if (command === "reset") showStart();
		if (command === "calibrate") startCalibration();
		if (command === "settings") document.getElementById("settings-btn").click();
		if (command === "about") document.getElementById("about-btn").click();
	});

	// ---- live status mark (driven only by existing engine state and click events)
	const markCanvas = document.getElementById("live-mark");
	const mark = new Mark("thinking");
	let markBase = "thinking";
	let actingUntil = 0;
	engine.on("click", ({ down }) => {
		if (down) {
			mark.set("acting"); // retrigger on every click
			actingUntil = performance.now() + 650;
		}
	});
	let markColors = null;
	let markTheme = null;
	let lastMarkTime = performance.now();
	function drawMark(state, now) {
		const theme = document.documentElement.dataset.theme;
		if (!markColors || theme !== markTheme) {
			const style = getComputedStyle(document.documentElement);
			markTheme = theme;
			markColors = {
				bone: style.getPropertyValue("--mark-ring").trim(),
				ember: style.getPropertyValue("--ember").trim(),
				dim: style.getPropertyValue("--bone-2").trim(),
			};
		}
		const { state: wanted, level } = markStateFor(state, { calibrating: Boolean(calibration) });
		if (now >= actingUntil && wanted !== markBase) {
			markBase = wanted;
			mark.set(wanted);
		} else if (now >= actingUntil && mark.s === "acting") {
			mark.set(markBase);
		}
		const dt = Math.min(0.1, (now - lastMarkTime) / 1000);
		lastMarkTime = now;
		mark.update(dt, now / 1000, level);
		mark.draw(markCanvas, 40, markColors);
	}

	// ---- render loop
	const STATUS_WORDS = { tracking: "TRACKING", paused: "PAUSED", "no-face": "NO FACE", starting: "STARTING", "camera-error": "NO CAMERA" };
	let lastStatus = "";
	// Instruments update at ~30 Hz: smooth to the eye, and it leaves the renderer's main thread
	// (which also runs tracking) mostly free. The camera video itself plays at full rate.
	const UI_FRAME_MS = 1000 / 30;
	let lastUiFrame = 0;
	function frameLoop(now) {
		requestAnimationFrame(frameLoop);
		if (now - lastUiFrame < UI_FRAME_MS - 2) {
			return;
		}
		lastUiFrame = now;
		const state = engine.getState();
		latestState = state;
		if (state.status !== lastStatus) {
			lastStatus = state.status;
			pill.dataset.status = state.status;
			setText(statusWord, STATUS_WORDS[state.status] ?? state.status.toUpperCase());
		}
		setText(fpsValue, state.camera?.status === "on" ? String(Math.round(state.fps)).padStart(2, "0") : "--");
		pauseBtn.setAttribute("aria-pressed", String(state.paused));
		setText(pauseLabel, state.paused ? "RESUME" : "PAUSE");
		const resume = isKiosk
			? "CLOSE YOUR EYES 2 S OR SAY “RESUME” TO RESUME"
			: st.get("closeEyesToToggle") ? "F9 OR CLOSE EYES 2S TO RESUME" : "PRESS F9 TO RESUME";
		setText(hint, state.paused ? resume : state.clickingMode === "dwell" ? "DWELL CLICK IS ON EVERYWHERE" : "REST ON ANY CONTROL TO PRESS IT");
		drawMark(state, now);
		viewfinder.update(state, engine.getFrame());
		attitude.update(state.pose);
		meters.update(state);
	}
	requestAnimationFrame(frameLoop);

	// ---- recovery: face lost / camera lost, without a restart
	if (!isPreview) {
		const recovery = createRecoveryMonitor();
		const banner = h("div", { class: "recovery-banner", role: "alert", hidden: true });
		document.body.append(banner);
		setInterval(() => {
			const state = engine.getState();
			const track = engine.getVideoStream?.()?.getVideoTracks?.()[0];
			for (const action of recovery.step(state, performance.now(), { trackEnded: track?.readyState === "ended" })) {
				if (action.type === "release") window.electronAPI?.releaseButtons?.("face-lost");
				if (action.type === "speak" && isKiosk && !calibration) speak(action.text);
				if (action.type === "retryCamera") {
					try {
						engine.useCamera();
					} catch (error) {
						console.warn("Camera retry failed:", error);
					}
				}
				if (action.type === "banner") {
					banner.hidden = !action.text;
					banner.textContent = action.text ?? "";
				}
			}
		}, 250);
	}

	// ---- first run
	if (isKiosk) {
		if (!st.get("onboardingComplete")) st.set("onboardingComplete", true);
		showStart();
	} else if (!isPreview && !st.get("onboardingComplete")) {
		openOnboarding({
			layer, engine,
			onFinish: () => st.set("onboardingComplete", true),
			onCalibrate: () => startCalibration(),
		});
	}

	if (isPreview) {
		await applyPreviewScene({ layer, engine, profiles, controls, dwell, startCalibration, host, theme, setTheme, toast });
	}

	await document.fonts.ready;
	// Let layout, ResizeObservers and a couple of frames settle before screenshots.
	await new Promise((r) => setTimeout(r, 700));
	window.__visionReady = true;
}

async function applyPreviewScene({ layer, engine, profiles, controls, dwell, startCalibration, host, theme, setTheme }) {
	const view = params.get("view") || "main";
	const calibData = {
		center: { yaw: 2, pitch: 3, leftEye: 0.29, rightEye: 0.3, mouth: 0.05, brow: 0.22 },
		range: { yawMin: -24, yawMax: 27, pitchMin: -12, pitchMax: 15 },
		peaks: { leftWink: 0.09, rightWink: 0.1, mouth: 0.52, brow: 0.31 },
	};
	if (view === "calib-center") startCalibration({ step: "center", data: { progress: 0.64 } });
	if (view === "calib-range") startCalibration({ step: "range", data: { ...calibData, pose: { yaw: -22, pitch: 8, roll: 3 }, dirs: ["LEFT", "RIGHT", "UP"] } });
	if (view === "calib-gestures") startCalibration({ step: "gestures", data: { ...calibData, taskIndex: 2 } });
	if (view === "calib-done") startCalibration({ step: "done", data: calibData });
	if (view.startsWith("onboarding")) {
		openOnboarding({ layer, engine, startAt: Number(view.split("-")[1] || 1) - 1 });
	}
	if (view === "settings") openSettings(layer, { engine, host, theme, onThemeChange: setTheme });
	if (view === "about") openAbout(layer, { version: "1.0.0" });
	if (view === "profiles") openProfiles(layer, { profiles, onChanged: () => controls.refresh() });
	if (view === "confirm") document.querySelector('[data-window="close"]').click();
	if (view === "main" && engine.fireSceneGesture) {
		setTimeout(() => engine.fireSceneGesture(), 150);
	}
	if (params.get("scene") === "dwell") {
		const target = document.querySelector(".toggles .toggle:nth-child(3)");
		const rect = target.getBoundingClientRect();
		dwell.showStatic(rect.left + rect.width * 0.62, rect.top + rect.height * 0.55, 0.68, target);
	}
}

boot().catch((error) => {
	console.error("VISION UI failed to start:", error);
	document.body.append(h("div", { class: "toast", style: { position: "fixed", left: "24px", bottom: "24px" } }, `VISION could not start: ${error.message}`));
	window.__visionReady = true;
});
