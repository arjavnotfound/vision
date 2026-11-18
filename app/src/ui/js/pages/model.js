// Page model for the VISION window (UX spec 1, 3, 9): the rail, the status lines and the
// setting presets. Pure functions, no DOM, so they are unit-tested in tests/page-model.test.mjs.

/** Rail order. Diagnostics and About are pages too, but they sit under Help and Settings. */
export const RAIL = [
	{ id: "home", label: "Home" },
	{ id: "face", label: "Face control" },
	{ id: "voice", label: "Voice" },
	{ id: "settings", label: "Settings" },
	{ id: "help", label: "Help" },
];

export const PAGE_LINES = {
	home: "What VISION is doing right now.",
	face: "How your head moves the cursor and how you click.",
	voice: "Talk to VISION to do things on the computer.",
	settings: "Change how VISION works for you.",
	help: "What each gesture does, and how to get help.",
};

export const SETTINGS_SECTIONS = ["clicking", "cursor", "voice", "display"];

/**
 * Where a page name leads: { page, section } with the rail item to fill.
 * Accepts "settings-voice", "about", "diagnostics" and the old uiCommand names.
 */
export function resolvePage(name) {
	const n = String(name || "").toLowerCase();
	if (n === "about") return { page: "settings", section: "about", rail: "settings" };
	if (n.startsWith("settings")) {
		const section = n.split(/[-:]/)[1];
		return { page: "settings", section: SETTINGS_SECTIONS.includes(section) ? section : null, rail: "settings" };
	}
	if (n === "diagnostics") return { page: "diagnostics", section: null, rail: "help" };
	if (n === "calibrate" || n === "face-control") return { page: "face", section: null, rail: "face" };
	const known = RAIL.find((item) => item.id === n);
	return { page: known ? n : "home", section: null, rail: known ? n : "home" };
}

/** Defaults for the shared setting keys (UX spec 11) while the engine may not have them yet. */
export const SETTING_DEFAULTS = {
	clickWink: true,
	clickBlink: false,
	clickMouth: false,
	clickDwell: false,
	dwellTime: 1000,
	pauseMethod: "blinks3",
	eyebrowRaiseOpensKeyboard: true,
	showMesh: true,
	headTrackingMinDistance: 0,
	headTrackingAcceleration: 0.5,
	uiTheme: "ember",
	startEnabled: true,
};

/**
 * Engine settings with a fallback for keys the engine does not know yet.
 * shortcut: unknown keys live in memory only; drop the fallback once chunk C adds them to core.
 */
export function settingsView(st) {
	const local = {};
	return {
		has: (key) => st.has(key) || key in local || key in SETTING_DEFAULTS,
		get: (key) => (st.has(key) ? st.get(key) : key in local ? local[key] : SETTING_DEFAULTS[key]),
		set: (key, value) => {
			if (st.has(key)) st.set(key, value);
			else local[key] = value;
		},
	};
}

export const CLICK_PRESETS = [
	{ id: "winks", label: "Winks", values: { clickWink: true, clickBlink: false, clickMouth: false, clickDwell: false } },
	{ id: "dwell", label: "Dwell only", values: { clickWink: false, clickBlink: false, clickMouth: false, clickDwell: true } },
	{ id: "mouth", label: "Mouth", values: { clickWink: false, clickBlink: false, clickMouth: true, clickDwell: false } },
];

/** Speed is the 1–10 level from controls.js; acceleration lives only in these presets. */
export const CURSOR_PRESETS = [
	{ id: "gentle", label: "Gentle", speed: 4, acceleration: 0.2 },
	{ id: "normal", label: "Normal", speed: 5, acceleration: 0.5 },
	{ id: "fast", label: "Fast", speed: 7, acceleration: 0.8 },
];

/** The preset whose values all match, or null. `get(key)` reads a setting. */
export function matchPreset(presets, get) {
	return presets.find((p) => Object.entries(p.values).every(([key, value]) => get(key) === value)) ?? null;
}

export function matchCursorPreset(speedLevel, acceleration) {
	return CURSOR_PRESETS.find((p) => p.speed === speedLevel && Math.abs(p.acceleration - acceleration) < 0.05) ?? null;
}

/** VISION's voice, in plain words. The model's voice names stay in the code. */
export const VOICES = [
	{ id: "Aoede", label: "Calm" },
	{ id: "Puck", label: "Bright" },
	{ id: "Charon", label: "Deep" },
];

export const WAKE_PHRASES = [
	{ id: "hey-vision", label: "Hey Vision" },
	{ id: "vision", label: "Vision" },
];

export const wakeWords = (phrase) => (phrase === "vision" ? "Vision" : "Hey Vision");

const pauseHow = (method) => (method === "closeEyes" ? "Close your eyes for 2 seconds" : "Blink three times quickly");

/** Face control status for Home: { title, line }. */
export function faceStatus(state, pauseMethod) {
	const how = pauseHow(pauseMethod);
	if (state?.status === "camera-error") return { title: "Face control is waiting for the camera", line: "Close any other app that uses the camera. VISION keeps trying." };
	if (state?.paused) return { title: "Face control is paused", line: `${how} to resume, or say “Vision, resume”. A helper can press F9.` };
	if (state?.status === "no-face") return { title: "Face control can’t see you", line: "Move your face into the camera’s view." };
	if (state?.status === "tracking") return { title: "Face control is on", line: `Your head moves the cursor. ${how} to pause.` };
	return { title: "Face control is starting", line: "This takes a few seconds." };
}

export const STATUS_WORDS = { tracking: "On", paused: "Paused", "no-face": "Can’t see you", starting: "Starting", "camera-error": "No camera" };

const KEY_ERROR = /key|auth|401|403|accept|unauthori[sz]ed|invalid/i;

/**
 * Voice status, always `<state> · <reason> · <action>` (UX spec 9.7).
 * `available`: voice is part of this build. `config`: from vision-voice-config (null when unread).
 * `bus`: the busState from main. Returns { state, reason, action: {label, go} | null, off, text }.
 */
export function voiceStatus({ available, config, bus, wakePhrase }) {
	const out = (state, reason, action = null, off = true) => ({ state, reason, action, off, text: [state, reason, action?.label].filter(Boolean).join(" · ") });
	if (!available) return out("Voice is off", "Not part of this version");
	if (!config) return out("Voice is off", "Voice settings can’t be read", { label: "Try again", go: "retry" });
	if (!config.hasKeys) return out("Voice is off", "Voice keys missing", { label: "Add keys", go: "settings-voice" });
	if (bus && bus.internet === false) return out("Voice is off", "No internet", { label: "Try again", go: "retry" });
	const agent = config.agent ?? {};
	if (agent.state === "error") {
		return KEY_ERROR.test(agent.message || "")
			? out("Voice is off", "Key not accepted", { label: "Check keys", go: "settings-voice" })
			: out("Voice is off", agent.message || "Voice could not start", { label: "Try again", go: "retry" });
	}
	if (agent.state === "starting") return out("Voice is starting", "Connecting", null, false);
	if (bus?.assistant?.live) return out("Voice is listening", "Speak now", null, false);
	return out("Voice is ready", `Say “${wakeWords(wakePhrase)}”`, null, false);
}
