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
import { openSettings, openProfiles, openConfirm } from "./sheets.js";
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
// One-app (hands-free) mode: adaptive calibration, spoken help, voice link.
const isKiosk = params.has("kiosk") && !isPreview;
// First run only: the Start screen, calibration and try-it.
const showStartScreen = isKiosk && params.has("start");
// Preview screenshots and QA runs stay silent; spoken lines still go to the log.
if (params.has("quiet") || params.has("preview")) setSpeechMuted(true);

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
	// The engine reads the language from localStorage at start-up.
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

	// Every way to quit (title bar, tray, voice) lands here: a dwell-safe Quit / Cancel.
	let quitDialog = null;
	function confirmQuit() {
		if (quitDialog?.isOpen()) return;
		const dialog = openConfirm(layer, {
			title: "Quit VISION?",
			text: "Head control and voice stop, and any held mouse button is released. To keep tracking without this window, choose Hide. Say “Vision, show face control” to bring it back.",
			confirmLabel: "Quit",
			danger: true,
			onConfirm: () => host.windowControl("quit"),
			secondary: { label: "Hide", onClick: () => host.windowControl("hide") },
		});
		quitDialog = { isOpen: () => dialog.box.isConnected };
		speak("Quit VISION? Rest on Quit to quit, or on Cancel to keep it running.");
	}

	for (const btn of document.querySelectorAll("[data-window]")) {
		btn.addEventListener("click", () => {
			const action = btn.dataset.window;
			if (action === "close") {
				confirmQuit();
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
		// Shown without taking focus: the user may be typing elsewhere. Answering or
		// ignoring it puts the window back the way it was.
		const before = host.windowControl("show-inactive");
		const putBack = async () => {
			const state = await before;
			if (state === "hidden") host.windowControl("hide");
			if (state === "minimized") host.windowControl("minimize");
		};
		// Ignored for 20 s: close it, so it never sits over the user's app.
		const ignored = setTimeout(() => { dialog.close(); putBack(); }, 20000);
		const answer = (fn) => () => { clearTimeout(ignored); fn(); putBack(); };
		const dialog = openConfirm(layer, {
			title: "Switch a control?",
			text,
			confirmLabel: "Yes, switch",
			onConfirm: answer(() => applySwitch(offer)),
			secondary: { label: "No, keep it", onClick: answer(() => { }) },
			// One decline, at the left edge: the centre, where the pointer rests, stays empty.
			cancel: false,
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
	// Settings > Voice talks to the main process; wake sensitivity lives in the settings file.
	const api = window.electronAPI;
	const voice = api?.getVoiceConfig ? {
		getConfig: () => api.getVoiceConfig(),
		setConfig: (change) => api.setVoiceConfig(change),
		saveKeys: (keys) => api.saveVoiceKeys(keys),
		getWake: async () => (await host.getOptions())?.globalSettings?.wakeSensitivity ?? "normal",
		setWake: (value) => api.setOptions({ globalSettings: { wakeSensitivity: value } }),
	} : null;
	let settingsSheet = null;
	const showSettings = async (initialTab) => {
		settingsSheet?.close();
		settingsSheet = openSettings(layer, {
			engine, host, voice, initialTab, version: await host.getVersion(),
			onChanged: () => { controls.refresh(); refreshLabels(); autosaveProfile(); },
			controlMap: { get: () => controlMap, set: applyPlan },
			onRecalibrate: () => startCalibration(),
			onKeyboard: () => engine.openOnScreenKeyboard(),
		});
	};
	document.getElementById("settings-btn").addEventListener("click", () => showSettings("Pointer"));
	document.getElementById("about-btn").addEventListener("click", () => showSettings("About"));
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
		if (command === "calibrate") startCalibration();
		if (command === "quit") confirmQuit();
		if (command === "settings") showSettings("Pointer");
		if (command === "settings-voice") showSettings("Voice");
		if (command === "about") showSettings("About");
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
	let windowShown = true;
	window.electronAPI?.onWindowShown?.((shown) => {
		windowShown = shown;
		viewfinder.setShown(shown);
	});
	// Paused or live, always on screen (above onboarding and calibration) and said aloud
	// when it changes, so the close-eyes toggle never leaves the user guessing.
	const cursorState = h("div", { class: "cursor-state", role: "status", "aria-live": "polite" });
	document.body.append(cursorState);
	let lastPaused = null;
	function showCursorState(state) {
		const noCamera = state.status === "camera-error";
		const paused = Boolean(state.paused);
		const key = `${paused}${noCamera}`;
		if (key === lastPaused) return;
		const first = lastPaused === null;
		const pauseChanged = !first && lastPaused.startsWith(String(!paused));
		lastPaused = key;
		cursorState.dataset.paused = String(paused || noCamera);
		if (noCamera) {
			cursorState.replaceChildren(h("span", { class: "cursor-state__dot" }), h("b", {}, "CURSOR STOPPED"), h("span", { class: "cursor-state__how" }, "Waiting for the camera"));
			return;
		}
		cursorState.replaceChildren(
			h("span", { class: "cursor-state__dot" }),
			h("b", {}, paused ? "CURSOR PAUSED" : "CURSOR LIVE"),
			h("span", { class: "cursor-state__how" }, st.get("closeEyesToToggle")
				? (paused ? "Close both eyes for 2 seconds to start it" : "Close both eyes for 2 seconds to pause")
				: (paused ? "Say “Vision, resume”" : "Say “Vision, pause”")),
		);
		// Calibration pauses the cursor by itself; that is not news to the user.
		if (pauseChanged && !calibration) speak(paused ? "Cursor paused. Close both eyes for 2 seconds to start it again." : "Cursor live. It follows your head now.");
	}

	function frameLoop(now) {
		requestAnimationFrame(frameLoop);
		if (now - lastUiFrame < UI_FRAME_MS - 2) {
			return;
		}
		lastUiFrame = now;
		const state = engine.getState();
		latestState = state;
		showCursorState(state);
		// The main view has its own status pill; the badge is for screens drawn over it.
		cursorState.hidden = !layer.childElementCount;
		if (!windowShown) return; // nothing to draw for; tracking runs in the engine's own loop
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
			: st.get("closeEyesToToggle") ? "CLOSE EYES 2S TO RESUME · OR F9" : "PRESS F9 TO RESUME";
		setText(hint, state.paused ? resume : state.clickingMode === "dwell" ? "DWELL CLICK IS ON EVERYWHERE" : "REST ON ANY CONTROL TO PRESS IT");
		drawMark(state, now);
		viewfinder.update(state, engine.getFrame());
		attitude.update(state.pose);
		meters.update(state);
	}
	requestAnimationFrame(frameLoop);

	// ---- recovery: face lost / camera lost, without a restart
	{
		const recovery = createRecoveryMonitor();
		const banner = h("div", { class: "recovery-banner", role: "alert", hidden: true });
		document.body.append(banner);
		setInterval(() => {
			const state = engine.getState();
			const track = engine.getVideoStream?.()?.getVideoTracks?.()[0];
			for (const action of recovery.step(state, performance.now(), { trackEnded: track?.readyState === "ended" })) {
				// Preview screenshots show the banner only: no buttons, no camera.
				if (isPreview && (action.type === "release" || action.type === "retryCamera")) continue;
				if (action.type === "release") window.electronAPI?.releaseButtons?.("face-lost");
				// Camera problems are always spoken: the user may not be able to read the banner.
				if (action.type === "speak" && (action.camera || (isKiosk && !calibration))) speak(action.text);
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
		if (showStartScreen) showStart();
	} else if (!isPreview && !st.get("onboardingComplete")) {
		// Same hands-free resume as the Start screen: onboarding tells a new user to close their eyes to start.
		if (st.has("closeEyesToToggle") && !st.get("closeEyesToToggle")) st.set("closeEyesToToggle", true);
		openOnboarding({
			layer, engine,
			onFinish: () => st.set("onboardingComplete", true),
			// Adaptive calibration reads each step aloud, like the rest of the first run.
			onCalibrate: () => startCalibration(null, { adaptive: true }),
		});
	}

	if (isPreview) {
		await applyPreviewScene({ layer, engine, profiles, controls, dwell, startCalibration, host, toast });
	}

	await document.fonts.ready;
	// Let layout, ResizeObservers and a couple of frames settle before screenshots.
	await new Promise((r) => setTimeout(r, 700));
	window.__visionReady = true;
}

async function applyPreviewScene({ layer, engine, profiles, controls, dwell, startCalibration, host }) {
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
	// ?view=calib-done&scene=no-face&accept=1: Accept with no face in view is refused.
	if (params.get("accept")) [...layer.querySelectorAll("button")].find((b) => /^(Accept|Apply)/.test(b.textContent))?.click();
	if (view.startsWith("onboarding")) {
		openOnboarding({ layer, engine, auto: false, startAt: Number(view.split("-")[1] || 1) - 1 });
	}
	// ?view=settings&tab=Voice: one screenshot per section.
	const voice = {
		getConfig: async () => ({ voice: "Aoede", language: "auto", hasKeys: !params.get("nokeys"), voices: [{ name: "Aoede", style: "Breezy" }, { name: "Puck", style: "Upbeat" }, { name: "Charon", style: "Informative" }, { name: "Kore", style: "Firm" }, { name: "Fenrir", style: "Excitable" }, { name: "Leda", style: "Youthful" }, { name: "Orus", style: "Firm" }], keyFields: [{ name: "LIVEKIT_URL", label: "LiveKit URL", hint: "starts with wss://, from cloud.livekit.io" }, { name: "LIVEKIT_API_KEY", label: "LiveKit API key", hint: "starts with API, same page" }, { name: "LIVEKIT_API_SECRET", label: "LiveKit API secret", hint: "same page", secret: true }, { name: "GOOGLE_API_KEY", label: "Gemini API key", hint: "from aistudio.google.com", secret: true }] }),
		setConfig: async () => ({}), saveKeys: async () => ({}), getWake: async () => "normal", setWake: () => { },
	};
	if (view === "settings") openSettings(layer, { engine, host, voice, version: "1.0.0", initialTab: params.get("tab") || "Pointer" });
	if (params.get("confirm") === "eyes") {
		engine.settings.set("closeEyesToToggle", true);
		[...layer.querySelectorAll(".toggle")].find((el) => el.textContent.includes("Close eyes"))?.click();
	}
	if (view === "about") openSettings(layer, { engine, host, voice, version: "1.0.0", initialTab: "About" });
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
