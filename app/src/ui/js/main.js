// VISION window entry point: one window with a left rail (Home, Face control, Voice,
// Settings, Help). Talks to the tracking engine ONLY through its public API
// (Vision.initEngine), or to the mock engine in --preview mode.

import { h, setText } from "./dom.js";
import { createDwell } from "./dwell.js";
import { openConfirm } from "./dialogs.js";
import { openCalibration } from "./calibration.js";
import { openOnboarding } from "./onboarding.js";
import { createHost } from "./host.js";
import { detectMisfire, controlSettings, createBrowClick, choosePlan, DEFAULT_PLAN, INPUT_LABELS, ACTION_LABELS } from "./control-map.js";
import { speak, setSpeechMuted } from "./speech.js";
import { createRecoveryMonitor } from "./recovery.js";
import { applySetting } from "./set-setting.js";
import { createShell } from "./shell.js";
import { settingsView, voiceStatus, STATUS_WORDS } from "./pages/model.js";
import { createHomePage } from "./pages/home.js";
import { createFacePage } from "./pages/face.js";
import { createVoicePage } from "./pages/voice.js";
import { createSettingsPage } from "./pages/settings.js";
import { createHelpPage, createDiagnosticsPage } from "./pages/help.js";

const params = new URLSearchParams(location.search);
const isPreview = params.has("preview");
const sceneName = params.get("scene") || "tracking";
// One-app (hands-free) mode: adaptive calibration, spoken help, voice link.
const isKiosk = params.has("kiosk") && !isPreview;
// First run only.
const showFirstRun = isKiosk && params.has("start");
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

// Preview only: voice settings and the bus without a main process.
const PREVIEW_VOICE = {
	getConfig: async () => ({
		voice: "Aoede", language: "auto", hasKeys: !params.get("nokeys"),
		keyFields: [{ name: "LIVEKIT_URL", label: "LiveKit URL", hint: "starts with wss://" }, { name: "LIVEKIT_API_KEY", label: "LiveKit API key", hint: "starts with API" }, { name: "LIVEKIT_API_SECRET", label: "LiveKit API secret", secret: true }, { name: "GOOGLE_API_KEY", label: "Gemini API key", hint: "from aistudio.google.com", secret: true }],
		savedKeys: [{ label: "LiveKit URL", value: "wss://example.livekit.cloud" }, { label: "LiveKit API key", value: "••••••3kQa" }, { label: "LiveKit API secret", value: "••••••x9Lp" }, { label: "Gemini API key", value: "••••••Tz4w" }],
		agent: params.get("voice") === "badkey" ? { state: "error", message: "401 Unauthorized" } : { state: "ready", message: null },
	}),
	setConfig: async () => ({}),
	saveKeys: async () => ({}),
};

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

	const api = window.electronAPI;
	const st = engine.settings;
	const settings = settingsView(st);
	const layer = document.getElementById("layer");
	const toasts = document.getElementById("toasts");

	// ---- theme
	const theme = () => document.documentElement.dataset.theme;
	const setTheme = (name, persist = true) => {
		document.documentElement.dataset.theme = name === "paper" ? "paper" : "ember";
		if (persist && st.has("uiTheme")) st.set("uiTheme", theme());
	};
	setTheme(params.get("theme") || st.get("uiTheme") || "ember", false);

	// ---- toasts (bottom right, never over the Pause row)
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
	createDwell({
		ring: document.getElementById("dwell-ring"),
		getDwellTime: () => settings.get("dwellTime") ?? 1000,
		// VISION's own buttons always take a deliberate dwell, whatever the click methods, so a
		// first-run user who can't wink is never stranded. Off while paused (the cursor then
		// belongs to a physical mouse) and when Dwell is on (the desktop overlay already
		// dwell-clicks everything, including this window).
		isEnabled: () => isPreview || (!latestState.paused && !settings.get("clickDwell") && latestState.status === "tracking"),
	});

	// ---- settings kept by the main process (wake phrase, island position, start with Windows)
	let globalSettings = {};
	try {
		globalSettings = (await host.getOptions())?.globalSettings ?? {};
	} catch (_error) {
		globalSettings = {};
	}
	const globals = {
		get: (key, fallback) => globalSettings[key] ?? fallback,
		set: (patch) => {
			Object.assign(globalSettings, patch);
			api?.setOptions?.({ globalSettings: patch });
		},
	};

	// ---- voice status: keys, internet and the voice agent, from main
	const voice = isPreview ? PREVIEW_VOICE : api?.getVoiceConfig ? {
		getConfig: () => api.getVoiceConfig(),
		setConfig: (change) => api.setVoiceConfig(change),
		saveKeys: (keys) => api.saveVoiceKeys(keys),
	} : null;
	let voiceConfig = null;
	// Main answers "No handler registered" when this build runs without voice.
	let voiceMissing = !voice;
	let busState = isPreview ? { internet: params.get("voice") !== "offline", assistant: { live: false } } : null;
	const refreshVoice = () => voiceMissing ? Promise.resolve() : voice.getConfig().then((config) => { voiceConfig = config; }, (error) => {
		voiceConfig = null;
		if (/No handler registered/.test(String(error?.message ?? error))) voiceMissing = true;
	});
	refreshVoice();
	const currentVoiceStatus = () => voiceStatus({ available: !voiceMissing, config: voiceConfig, bus: busState, wakePhrase: globals.get("wakePhrase", "hey-vision") });

	// Recent activity on the Voice page: what voice asked VISION to do.
	const activity = [];
	const logActivity = (text) => {
		const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
		activity.unshift({ time, text });
		activity.length = Math.min(activity.length, 20);
	};
	if (isPreview && params.get("activity")) {
		logActivity("Paused face control");
		logActivity("Opened Chrome");
		logActivity("Scrolled down");
	}

	// ---- calibration
	let calibration = null;
	let shell = null;
	const startCalibration = (preview = null, { adaptive = isKiosk } = {}) => {
		if (calibration) return;
		calibration = openCalibration({
			layer, engine, toast, preview, adaptive,
			onPlan: (plan) => saveControlMap(plan),
			onDetails: () => shell.navigate("diagnostics"),
			onClose: () => {
				calibration = null;
			},
		});
	};

	// ---- the shell and its pages
	let windowShown = true;
	const ctx = {
		engine, settings, host, layer, toast, voice, globals, activity,
		navigate: (page) => shell.navigate(page),
		startCalibration: () => startCalibration(),
		pulse: () => api?.pulse?.(),
		windowShown: () => windowShown,
		theme, setTheme,
		version: () => appVersion,
		wakePhrase: () => globals.get("wakePhrase", "hey-vision"),
		voiceStatus: currentVoiceStatus,
		refreshVoice,
		voiceAction: (action) => (action.go === "retry" ? refreshVoice() : shell.navigate(action.go)),
		// The engine runs in this renderer and emits the 10 Hz diag sample itself.
		onDiag: (cb) => engine.on("diag", cb),
	};
	let appVersion = "";
	host.getVersion().then((v) => { appVersion = v || ""; }, () => { });
	shell = createShell({
		railEl: document.getElementById("rail"),
		pagesEl: document.getElementById("pages"),
		factories: {
			home: () => createHomePage(ctx),
			face: () => createFacePage(ctx),
			voice: () => createVoicePage(ctx),
			settings: () => createSettingsPage(ctx),
			help: () => createHelpPage(ctx),
			diagnostics: () => createDiagnosticsPage(ctx),
		},
	});
	// Opened from outside (island menu, voice, tray): show the window on that page.
	const openPage = (page) => {
		shell.navigate(page);
		host.windowControl("show");
	};
	engine.on("settings", ({ key }) => {
		if (key === "uiTheme" && st.get("uiTheme") !== theme()) setTheme(st.get("uiTheme"), false);
	});

	// A click toast on the camera view whenever a click gesture fires.
	const CLICK_TOAST = { left: "Left click", right: "Right click", middle: "Middle click" };
	engine.on("click", ({ button, down }) => {
		if (down && CLICK_TOAST[button]) shell.page("face")?.viewfinder.toast(CLICK_TOAST[button], isPreview ? 5000 : 1200);
	});

	// Every way to quit (title bar, tray, voice) lands here. Keep open is the big default;
	// Quit sits alone on the left and needs a longer dwell, so a drifting cursor can't quit.
	let quitDialog = null;
	function confirmQuit() {
		if (quitDialog?.box.isConnected) return;
		quitDialog = openConfirm(layer, {
			title: "Quit VISION?",
			text: "Face control and voice will stop until VISION is started again.",
			confirmLabel: "Keep VISION open",
			onConfirm: () => { },
			cancel: false,
			secondary: { label: "Quit VISION", danger: true, delay: 1500, onClick: () => host.windowControl("quit") },
		});
		speak("Quit VISION? Rest on Keep VISION open to keep it running. To quit, rest longer on Quit VISION, on the left.");
	}

	for (const btn of document.querySelectorAll("[data-window]")) {
		btn.addEventListener("click", () => {
			if (btn.dataset.window === "close") confirmQuit();
			else host.windowControl(btn.dataset.window);
		});
	}

	// ---- adaptive control map (stored in the settings file next to the engine settings)
	let controlMap = globalSettings.controlMap ?? null;
	function saveControlMap(plan) {
		controlMap = plan;
		api?.setOptions?.({ globalSettings: { controlMap: plan } });
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
			api?.mappedClick?.("right");
			shell.page("face")?.viewfinder.toast("Right click", 1200);
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
		const next = choosePlan(controlMap ?? DEFAULT_PLAN, offer.action, offer.to);
		for (const [key, value] of Object.entries(controlSettings(next))) {
			if (st.has(key)) st.set(key, value);
		}
		saveControlMap(next);
		speak(`Done. ${ACTION_LABELS[offer.action]} is now: ${INPUT_LABELS[offer.to].toLowerCase()}.`);
	}
	let onboarding = null;
	if (isKiosk) {
		setInterval(() => {
			const now = performance.now();
			if (latestState.status !== "tracking") {
				trackingSince = 0;
				return;
			}
			trackingSince ||= now;
			if (calibration || onboarding || now - lastOffer < 120000) return;
			const offer = detectMisfire({ events: gestureClicks, now, trackingSince, plan: controlMap });
			if (offer) {
				gestureClicks.length = 0;
				trackingSince = now;
				offerSwitch(offer);
			}
		}, 2000);
	}

	// ---- link to the voice assistant
	api?.onBusState?.((state) => {
		const was = busState?.assistant?.connected;
		busState = state;
		const now = Boolean(state?.assistant?.connected);
		if (was !== undefined && was !== now) logActivity(now ? "Voice connected" : "Voice disconnected");
	});
	api?.requestBusState?.();

	const SPEED_KEYS = ["headTrackingSensitivityX", "headTrackingSensitivityY"];
	const CLICK_METHODS = { wink: "clickWink", blink: "clickBlink", dwell: "clickDwell", mouth: "clickMouth" };
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
			calibration?.close?.(false);
			calibration = null;
			startCalibration(null, { adaptive: true });
			return { done: "calibrating" };
		}
		if (cmd === "navigate") {
			openPage(String(value));
			return { done: `showing ${shell.current()}` };
		}
		if (cmd === "speed") {
			const factor = value === "faster" ? 1.25 : value === "slower" ? 0.8 : NaN;
			if (!Number.isFinite(factor)) return { done: "none", error: "say faster or slower" };
			for (const key of SPEED_KEYS) {
				const next = Math.round(Math.min(0.1, Math.max(0.001, st.get(key) * factor)) * 10000) / 10000;
				st.set(key, next);
			}
			return { done: `cursor ${value}`, sensitivity: st.get(SPEED_KEYS[0]) };
		}
		if (cmd === "click-mode") {
			// "Click with winks": that method alone, the way the Settings presets work.
			const name = String(value).toLowerCase();
			if (!CLICK_METHODS[name]) return { done: "none", error: "use wink, blink, dwell or mouth" };
			for (const [method, key] of Object.entries(CLICK_METHODS)) if (st.has(key)) st.set(key, method === name);
			if (name === "wink" || name === "dwell") saveControlMap(choosePlan(controlMap ?? DEFAULT_PLAN, "leftClick", name === "wink" ? "leftWink" : "dwell"));
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
		if (cmd === "retry-camera") {
			engine.useCamera();
			return { done: "retrying camera", camera: engine.getState().camera?.status };
		}
		if (cmd === "set-setting" && value && typeof value === "object") {
			return applySetting(String(value.name), value.value, { st, engine });
		}
		if (cmd === "controls") {
			return { done: "controls", controlMap, clickMethods: Object.keys(CLICK_METHODS).filter((m) => st.get(CLICK_METHODS[m])) };
		}
		return { done: cmd };
	}
	host.onCommand?.((command) => {
		if (command && typeof command === "object" && command.type === "bus") {
			let result;
			try {
				result = handleBusCommand(command.cmd, command.value);
			} catch (error) {
				result = { done: "none", error: String(error?.message ?? error) };
			}
			if (result?.done && result.done !== "none" && command.cmd !== "controls") logActivity(result.done[0].toUpperCase() + result.done.slice(1));
			api?.replyBusCommand?.(command.id, result);
			return;
		}
		if (command && typeof command === "object" && command.type === "navigate") return openPage(command.page);
		if (command === "calibrate") {
			openPage("face");
			startCalibration();
		}
		if (command === "quit") confirmQuit();
		if (command === "settings" || command === "settings-voice" || command === "about" || command === "help" || command === "diagnostics") openPage(command);
	});
	// vision:navigate (UX spec 11) from the island menu.
	api?.onNavigate?.((page) => openPage(page));

	// ---- render loop
	const pill = document.querySelector(".status-pill");
	const statusWord = document.getElementById("status-word");
	let lastStatus = "";
	// Pages update at ~30 Hz: smooth to the eye, and it leaves the renderer's main thread
	// (which also runs tracking) mostly free. The camera video itself plays at full rate.
	const UI_FRAME_MS = 1000 / 30;
	let lastUiFrame = 0;
	api?.onWindowShown?.((shown) => {
		windowShown = shown;
		shell.page("face")?.viewfinder.setShown(shown && shell.current() === "face");
	});
	// Said aloud when face control pauses or resumes, so the user is never left guessing.
	let lastPaused = null;
	function speakPause(state) {
		const paused = Boolean(state.paused);
		if (lastPaused !== null && paused !== lastPaused && !calibration) {
			const how = settings.get("pauseMethod") === "closeEyes" ? "Close your eyes for 2 seconds" : "Blink three times quickly";
			speak(paused ? `Face control paused. ${how} to start it again.` : "Face control on. The cursor follows your head now.");
		}
		lastPaused = paused;
	}

	function frameLoop(now) {
		requestAnimationFrame(frameLoop);
		if (now - lastUiFrame < UI_FRAME_MS - 2) return;
		lastUiFrame = now;
		const state = engine.getState();
		latestState = state;
		speakPause(state);
		if (!windowShown) return; // nothing to draw for; tracking runs in the engine's own loop
		const status = state.paused ? "paused" : state.status;
		if (status !== lastStatus) {
			lastStatus = status;
			pill.dataset.status = status;
			setText(statusWord, STATUS_WORDS[status] ?? status);
		}
		shell.update(state);
	}
	requestAnimationFrame(frameLoop);
	// Voice status can change without an event (keys saved, agent restarted).
	setInterval(() => {
		if (windowShown && ["home", "voice"].includes(shell.current())) refreshVoice();
	}, 5000);

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
				if (action.type === "release") api?.releaseButtons?.("face-lost");
				// Camera problems are always spoken: the user may not be able to read the banner.
				if (action.type === "speak" && (action.camera ? !onboarding : isKiosk && !calibration)) speak(action.text);
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

	shell.navigate(isPreview ? previewPage() : "home");

	// ---- first run (4 steps, chunk D's onboarding)
	const firstRun = isKiosk ? showFirstRun : !isPreview && !st.get("onboardingComplete");
	if (isKiosk && !st.get("onboardingComplete")) st.set("onboardingComplete", true);
	if (firstRun) {
		host.windowControl("show");
		onboarding = openOnboarding({
			layer, engine, toast,
			adaptive: isKiosk,
			onPlan: (plan) => saveControlMap(plan),
			onFinish: (choice) => {
				onboarding = null;
				// The methods picked in setup win over what calibration suggested for left click.
				if (choice && controlMap) {
					const left = choice.clickWink ? "leftWink" : choice.clickDwell ? "dwell" : null;
					if (left && controlMap.leftClick !== left) saveControlMap(choosePlan(controlMap, "leftClick", left));
				}
				st.set("onboardingComplete", true);
				shell.navigate("home");
			},
			hasVoiceKeys: () => voice ? voice.getConfig().then((config) => Boolean(config?.hasKeys)) : Promise.resolve(false),
		});
	}

	if (isPreview) applyPreviewScene({ layer, engine, startCalibration, confirmQuit });

	await document.fonts.ready;
	// Let layout, ResizeObservers and a couple of frames settle before screenshots.
	await new Promise((r) => setTimeout(r, 700));
	window.__visionReady = true;
}

/** Preview: ?view=<page>[&section=<settings section>] picks the page. */
function previewPage() {
	const view = params.get("view") || "home";
	if (view === "settings") return `settings-${params.get("section") || "clicking"}`;
	return ["home", "face", "voice", "help", "diagnostics", "about"].includes(view) ? view : view === "main" ? "face" : "home";
}

function applyPreviewScene({ layer, engine, startCalibration, confirmQuit }) {
	const view = params.get("view") || "home";
	const calibData = {
		center: { yaw: 2, pitch: 3, leftEye: 0.29, rightEye: 0.3, mouth: 0.05, brow: 0.22 },
		range: { yawMin: -24, yawMax: 27, pitchMin: -12, pitchMax: 15 },
	};
	if (view === "calib-center") startCalibration({ step: "center", data: { progress: 0.64 } });
	if (view === "calib-range") startCalibration({ step: "range", data: { ...calibData, pose: { yaw: -22, pitch: 8, roll: 3 } } });
	if (view === "calib-gestures") startCalibration({ step: "gestures", data: { ...calibData, taskIndex: 2 } });
	if (view === "calib-done") startCalibration({ step: "done", data: calibData });
	if (view === "calib-refused") startCalibration({ step: "refused", data: calibData });
	// ?view=calib-done&scene=no-face&accept=1: "Use this" with no face in view is refused.
	if (params.get("accept")) setTimeout(() => [...layer.querySelectorAll("button")].find((b) => /^Use this/.test(b.textContent))?.click(), 100);
	if (view.startsWith("onboarding")) openOnboarding({ layer, engine, auto: false, startAt: Number(view.split("-")[1] || 1) - 1 });
	if (view === "quit") confirmQuit();
	if (params.get("reset")) [...document.querySelectorAll(".settings-foot button")][0]?.click();
	if (params.get("keys")) setTimeout(() => [...document.querySelectorAll(".srow--keys button")].find((b) => /voice keys$/.test(b.textContent))?.click(), 200);
	if (view === "face" && engine.fireSceneGesture) setTimeout(() => engine.fireSceneGesture(), 150);
}

boot().catch((error) => {
	console.error("VISION UI failed to start:", error);
	document.body.append(h("div", { class: "toast", style: { position: "fixed", right: "24px", bottom: "24px" } }, `VISION could not start: ${error.message}`));
	window.__visionReady = true;
});
