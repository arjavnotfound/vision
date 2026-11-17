// Temporary QA harness for chunk D (calibration, Diagnostics, first run, gesture card) on the
// mock engine: harness-d.html?view=<name>&scene=<mock scene>&freeze. Silent.
import { createMockEngine } from "./mock-engine.js";
import { setSpeechMuted } from "./speech.js";
import { mount as mountCalibration } from "./calibration.js";
import { mount as mountDiagnostics } from "./diagnostics.js";
import { mount as mountOnboarding } from "./onboarding.js";
import { mount as mountGestureCard } from "./gesture-card.js";
import { createViewfinder } from "./viewfinder.js";

setSpeechMuted(true);
const params = new URLSearchParams(location.search);
const view = params.get("view") || "diagnostics";
const engine = createMockEngine(params.get("scene") || "tracking");
const st = engine.settings;
// The new shared setting keys (UX spec 11), until chunk C adds them to the engine.
for (const [key, value] of Object.entries({ clickWink: true, clickBlink: false, clickMouth: false, clickDwell: true, dwellTime: 1000, pauseMethod: "blinks3", showMesh: params.get("mesh") !== "0", eyebrowRaiseOpensKeyboard: true, headTrackingTiltInfluence: 0.3 })) {
	if (!st.has(key)) st.set(key, value);
}
// Fields chunk C adds to the engine state (light, confidence).
const baseState = engine.getState;
engine.getState = () => ({ confidence: 0.94, ...baseState() });

const layer = document.getElementById("layer");
const page = document.getElementById("page");
const calib = {
	center: { yaw: 2, pitch: 3, leftEye: 0.29, rightEye: 0.3, mouth: 0.05, brow: 0.22 },
	range: { yawMin: -25, yawMax: 26, pitchMin: -12, pitchMax: 15 },
};

if (view === "calib-center") mountCalibration(layer, { engine, preview: { step: "center", data: { progress: 0.64 } } });
if (view === "calib-range") mountCalibration(layer, { engine, preview: { step: "range", data: { ...calib, now: { left: 0, right: 0, up: 0, down: 9 } } } });
if (view === "calib-summary" || view === "calib-details") {
	mountCalibration(layer, { engine, preview: { step: "done", data: calib }, onDetails: () => {} });
	if (view === "calib-details") [...layer.querySelectorAll("button")].find((b) => b.textContent === "Details").click();
}
// Refusal: the real guard, by pressing "Use this" with no face in view (scene=no-face).
if (view === "calib-refused") {
	const c = mountCalibration(layer, { engine, preview: { step: "done", data: calib } });
	c.apply();
}
if (view === "diagnostics") mountDiagnostics(page, { engine });
if (view.startsWith("first-run-")) {
	const step = Number(view.split("-")[2]) - 1;
	mountOnboarding(layer, { engine, auto: false, startAt: step, preview: { tried: ["wink"], listening: "blink", calibration: { step: "range", data: calib } } });
}
if (view === "gesture-card") {
	const host = document.createElement("div");
	host.id = "card";
	page.append(host);
	mountGestureCard(host, { settings: st });
}
if (view === "mesh") {
	const vf = createViewfinder(page, { engine, readouts: false, guide: false, hint: false });
	const loop = () => { requestAnimationFrame(loop); vf.update(engine.getState(), engine.getFrame()); };
	loop();
}

await document.fonts.ready;
await new Promise((r) => setTimeout(r, 600));
window.__ready = true;
