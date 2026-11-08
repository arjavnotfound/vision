// Mock engine for --preview: same API as Vision.initEngine(), with deterministic state per
// scene and a dot-mesh face (no camera image, never an illustrated face).
// No camera, no tracking, no mouse control.

import { gestureBindings } from "./labels.js";
import { buildFace, deformFace, proj, isKeyKind } from "./face-mesh.js";

const W = 640;
const H = 480;

const DEFAULT_SETTINGS = {
	headTrackingSensitivityX: 0.025,
	headTrackingSensitivityY: 0.05,
	headTrackingAcceleration: 0.5,
	headTrackingTiltInfluence: 0,
	headTrackingMinDistance: 0,
	headTiltYawOffset: 0,
	headTiltPitchOffset: 2.5 * Math.PI / 180,
	headTiltYawRange: 60 * Math.PI / 180,
	headTiltPitchRange: 25 * Math.PI / 180,
	clickingMode: "blink",
	swapMouseButtons: false,
	delayBeforeDragging: 800,
	dwellTime: 800,
	dwellDrag: false,
	mouthTiltScroll: true,
	cameraDeviceId: "",
	mirror: true,
	soundEffects: true,
	startEnabled: false,
	closeEyesToToggle: true,
	eyebrowRaiseOpensKeyboard: true,
	runAtLogin: false,
	language: "en",
	eyeThresholdHigh: 0.2,
	eyeThresholdLow: 0.16,
	mouthThresholdHigh: 0.25,
	mouthThresholdLow: 0.15,
	browThresholdHigh: 0.28,
	browThresholdLow: 0.24,
	profiles: JSON.stringify([{ name: "Default", values: {} }, { name: "Evening", values: {} }]),
	activeProfile: "Default",
	onboardingComplete: true,
	uiTheme: "ember",
};

const LANGUAGES = [
	["en", "English"], ["hi", "हिन्दी (Hindi)"], ["bn", "বাংলা (Bengali)"], ["ta", "தமிழ் (Tamil)"], ["te", "తెలుగు (Telugu)"], ["mr", "मराठी (Marathi)"],
	["gu", "ગુજરાતી (Gujarati)"], ["pa", "ਪੰਜਾਬੀ (Punjabi)"], ["ur", "اردو (Urdu)"], ["es", "Español (Spanish)"], ["fr", "Français (French)"], ["de", "Deutsch (German)"],
	["ja", "日本語 (Japanese)"], ["ko", "한국어 (Korean)"], ["zh", "繁體中文"], ["ar", "العربية (Arabic)"], ["it", "Italiano"], ["nl", "Nederlands"],
];

/** Scene presets. Pose in engine degrees (yaw positive = head turned left). */
export const SCENES = {
	tracking: { status: "tracking", pose: { yaw: -9, pitch: 4, roll: 3 }, motion: [1.4, -0.6] },
	paused: { status: "paused", paused: true, pose: { yaw: 2, pitch: 1, roll: -1 } },
	"no-face": { status: "no-face", faceFound: false },
	"low-light": { status: "tracking", brightness: 34, pose: { yaw: -3, pitch: -2, roll: 1 } },
	gesture: { status: "tracking", pose: { yaw: -6, pitch: 2, roll: 2 }, leftEye: 0.07, fire: { gesture: "leftWink", action: "LEFT CLICK", button: "left" } },
	"gesture-mouth": { status: "tracking", pose: { yaw: 4, pitch: 9, roll: -2 }, mouth: 0.46, scroll: -1, settings: { clickingMode: "open-mouth-simple" }, fire: { gesture: "mouth", action: "CLICK · TILT SCROLL" } },
	dwell: { status: "tracking", pose: { yaw: -5, pitch: 3, roll: 1 }, settings: { clickingMode: "blink" } },
	"camera-error": { status: "camera-error", camera: "error" },
	framing: { status: "tracking", faceShift: [105, 45], faceScale: 0.72, pose: { yaw: 14, pitch: -6, roll: 4 } },
	range: { status: "tracking", pose: { yaw: -22, pitch: 8, roll: 3 }, motion: [3.2, -1.1] },
};

export function createMockEngine(sceneName = "tracking") {
	const scene = SCENES[sceneName] ?? SCENES.tracking;
	const settings = { ...DEFAULT_SETTINGS, ...(scene.settings ?? {}) };
	let paused = Boolean(scene.paused);
	const listeners = new Map();
	const emit = (type, payload) => listeners.get(type)?.forEach((cb) => cb(payload));
	const t0 = performance.now();
	const freeze = new URLSearchParams(location.search).has("freeze");

	function pose() {
		const base = scene.pose ?? { yaw: 0, pitch: 0, roll: 0 };
		if (freeze) return { ...base };
		const t = (performance.now() - t0) / 1000;
		return { yaw: base.yaw + Math.sin(t * 0.7) * 3, pitch: base.pitch + Math.sin(t * 0.9 + 1) * 2, roll: base.roll + Math.sin(t * 0.5 + 2) * 1.5 };
	}

	// One dot-mesh face, deformed by the scene's gestures and projected with the pose.
	const FACE = buildFace();
	const FLOW_POINTS = 44;
	const clamp01 = (v) => Math.max(0, Math.min(1, v));

	function frame() {
		const faceFound = scene.faceFound !== false && scene.status !== "camera-error";
		if (!faceFound) {
			return { width: W, height: H, mirror: settings.mirror, pointCount: 0, points: new Float32Array(0), mesh: { pts: [], lines: [], nose: null }, nose: null, motion: [0, 0], faceBox: null };
		}
		deformFace(FACE, {
			leftWink: clamp01((0.3 - (scene.leftEye ?? 0.3)) / 0.25),
			rightWink: clamp01((0.3 - (scene.rightEye ?? 0.3)) / 0.25),
			mouth: clamp01(((scene.mouth ?? 0.05) - 0.05) / 0.45),
			brow: clamp01(((scene.brow ?? 0.22) - 0.22) / 0.12),
		});
		const shift = scene.faceShift ?? [0, 0];
		const k = scene.faceScale ?? 1;
		const sc = Math.min(W, H) * 0.33 * k;
		const p = pose();
		const pts = FACE.pts.map((pt) => {
			const [x, y, depth] = proj(pt, p, W / 2 + shift[0], H * 0.5 + shift[1], sc);
			return [x, y, depth, isKeyKind(pt.k)];
		});
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const [x, y] of pts) {
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
		const nose = pts[FACE.nose].slice(0, 2);
		return {
			width: W,
			height: H,
			mirror: settings.mirror,
			pointCount: FLOW_POINTS,
			points: new Float32Array(0),
			mesh: { pts, lines: FACE.lines, nose },
			nose,
			motion: scene.motion ?? [0.6, 0.2],
			faceBox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
		};
	}

	function state() {
		const faceFound = scene.faceFound !== false && scene.status !== "camera-error";
		const status = scene.status === "camera-error" ? "camera-error" : paused ? "paused" : faceFound ? "tracking" : "no-face";
		const f = frame();
		const brightness = scene.brightness ?? 128;
		let framing;
		if (brightness < 55) framing = { ok: false, code: "dark", hint: "MORE LIGHT" };
		else if (!faceFound) framing = { ok: false, code: "no-face", hint: "LOOK AT THE CAMERA" };
		else if (scene.faceShift) framing = { ok: false, code: "off-center", hint: "CENTER YOUR FACE" };
		else framing = { ok: true, code: "ok", hint: "FRAMED" };
		const t = (performance.now() - t0) / 1000;
		const wobble = freeze ? 0 : Math.sin(t * 2.3) * 0.01;
		const leftRatio = scene.leftEye ?? 0.27 + wobble;
		const thresholds = {
			eye: { high: settings.eyeThresholdHigh, low: settings.eyeThresholdLow },
			mouth: { high: settings.mouthThresholdHigh, low: settings.mouthThresholdLow },
			brow: { high: settings.browThresholdHigh, low: settings.browThresholdLow },
		};
		const leftActive = leftRatio <= thresholds.eye.low;
		const mouthRatio = scene.mouth ?? 0.06 + Math.abs(wobble);
		return {
			status,
			paused,
			fps: freeze ? 60 : 59 + Math.round(Math.sin(t) * 1),
			facemeshHz: 30,
			faceFound,
			tracker: "facemesh",
			points: faceFound ? f.pointCount : 0,
			pose: faceFound ? pose() : { yaw: 0, pitch: 0, roll: 0 },
			gestures: faceFound ? {
				leftEye: { ratio: leftRatio, open: !leftActive, active: leftActive },
				rightEye: { ratio: scene.rightEye ?? 0.28 - wobble, open: true, active: false },
				mouth: { ratio: mouthRatio, open: mouthRatio > thresholds.mouth.high, active: mouthRatio > thresholds.mouth.high },
				brow: { ratio: scene.brow ?? 0.22 + wobble, raised: false, progress: 0 },
				sleep: { progress: 0, enabled: settings.closeEyesToToggle },
				scroll: scene.scroll ?? 0,
				thresholds,
				bindings: gestureBindings(settings),
				active: [...(leftActive ? ["leftWink"] : []), ...(mouthRatio > thresholds.mouth.high ? ["mouth"] : [])],
			} : null,
			buttons: { left: leftActive, middle: false, right: false },
			cursor: { x: 960, y: 540 },
			clickingMode: settings.clickingMode,
			camera: { status: scene.camera === "error" ? "error" : "on", error: scene.camera === "error" ? { name: "NotReadableError", message: "Device in use" } : null, width: W, height: H },
			framing: { ...framing, brightness },
			lastError: null,
		};
	}

	const descriptors = {
		language: { key: "language", type: "dropdown", options: LANGUAGES.map(([value, label]) => ({ value, label })) },
	};

	return {
		isMock: true,
		getState: state,
		getFrame: frame,
		getVideoStream: () => null,
		on(type, cb) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type).add(cb);
			return () => listeners.get(type)?.delete(cb);
		},
		off(type, cb) {
			listeners.get(type)?.delete(cb);
		},
		settings: {
			get: (key) => settings[key],
			getAll: () => ({ ...settings }),
			has: (key) => key in settings,
			set: (key, value) => {
				settings[key] = value;
				emit("settings", { key, value });
			},
			describe: (key) => descriptors[key] ?? { key, type: typeof settings[key] },
			keys: () => Object.keys(settings),
		},
		isPaused: () => paused,
		setPaused: (value) => { paused = Boolean(value); },
		togglePaused: () => { paused = !paused; },
		useCamera: () => { },
		openOnScreenKeyboard: () => emit("toast", { message: "On-screen keyboard opened" }),
		ready: () => Promise.resolve(),
		/** Preview helper: replay this scene's gesture firing. */
		fireSceneGesture() {
			if (scene.fire) {
				emit("gesture", { ...scene.fire, phase: "start" });
				if (scene.fire.button) emit("click", { button: scene.fire.button, down: true, source: "gesture" });
			}
		},
		emit,
	};
}
