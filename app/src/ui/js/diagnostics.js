// Diagnostics page (UX spec 5): how well VISION sees you right now. The camera with the mesh
// (always on), one bar per gesture with its live value and threshold marker, camera FPS,
// light level, tracking confidence, and the items that moved here from Settings and About:
// head angles, flow points, face mesh rate, click method, Tilt to point, Copy diagnostics.
//
// mount(el, { engine, diag }) — `diag` is optional: a function that subscribes to the
// vision:diag stream and returns an unsubscribe function. Its fps / light / confidence win
// over the values read from engine.getState().

import { h, setText, signed } from "./dom.js";
import { createViewfinder } from "./viewfinder.js";
import { createMeters } from "./meters.js";
import { ensureBuildDStyles } from "./d-style.js";

// Same limit as core framing (minBrightness 55): below it landmarks get unreliable.
export const LIGHT_LOW = 55;
export const LIGHT_GOOD = 100;

/** "Low" / "OK" / "Good" for a mean face brightness 0..255, or null when unknown. */
export function lightLevel(brightness) {
	if (!Number.isFinite(brightness)) return null;
	return brightness < LIGHT_LOW ? "Low" : brightness < LIGHT_GOOD ? "OK" : "Good";
}

/** Merge engine state with the optional vision:diag sample into the numbers the page shows. */
export function readDiagnostics(state, diag = null, settings = null) {
	const light = diag?.light ?? state?.light ?? state?.framing?.brightness;
	const confidence = diag?.confidence ?? state?.confidence;
	return {
		fps: diag?.fps ?? state?.fps,
		light: Number.isFinite(light) ? Math.round(light) : null,
		lightLevel: lightLevel(light),
		// confidence may arrive as 0..1 or as a percentage
		confidence: Number.isFinite(confidence) ? Math.round(confidence <= 1 ? confidence * 100 : confidence) : null,
		pose: diag?.pose ?? state?.pose ?? { yaw: 0, pitch: 0, roll: 0 },
		points: state?.points ?? 0,
		facemeshHz: state?.facemeshHz,
		clickMethod: clickMethodNames(settings) ?? state?.clickingMode ?? "–",
	};
}

/** "Wink, Dwell" from the clickWink / clickBlink / clickMouth / clickDwell settings, or null before they exist. */
export function clickMethodNames(settings) {
	const keys = [["clickWink", "Wink"], ["clickBlink", "Blink"], ["clickMouth", "Mouth"], ["clickDwell", "Dwell"]];
	if (!settings?.has?.("clickWink")) return null;
	const on = keys.filter(([key]) => settings.get(key)).map(([, name]) => name);
	return on.length ? on.join(", ") : "None";
}

/** Plain-text report for "Copy diagnostics". */
export function diagnosticsText(state, d) {
	const deg = (v) => `${v >= 0 ? "+" : ""}${Number(v || 0).toFixed(1)}°`;
	return [
		`Status            ${state?.status ?? "-"}${state?.paused ? " (paused)" : ""}`,
		`Camera            ${state?.camera?.status ?? "-"} · ${state?.camera?.width ?? "-"}×${state?.camera?.height ?? "-"} · ${Math.round(d.fps || 0)} fps`,
		`Light             ${d.lightLevel ?? "-"} (${d.light ?? "-"})`,
		`Tracking          ${d.confidence ?? "-"}%`,
		`Face mesh         ${d.facemeshHz ?? "-"} Hz · ${d.points} flow points`,
		`Head              turn ${deg(-d.pose.yaw)} · tilt ${deg(d.pose.pitch)} · roll ${deg(d.pose.roll)}`,
		`Click method      ${d.clickMethod}`,
	].join("\n");
}

export function mount(el, { engine, diag = null } = {}) {
	ensureBuildDStyles();
	let lastDiag = null;
	const unsubscribe = diag ? diag((sample) => { lastDiag = sample; }) : null;

	const vfHost = h("div");
	const metersHost = h("div", { class: "meters d-meters" });
	const tile = (name) => {
		const value = h("span", { class: "d-tile__value" }, "–");
		const note = h("span", { class: "d-tile__note" }, "");
		return { el: h("div", { class: "d-tile" }, h("span", { class: "d-tile__name" }, name), value, note), value, note };
	};
	const fps = tile("Camera");
	const light = tile("Light");
	const confidence = tile("Tracking");
	const head = tile("Head angles");
	const mesh = tile("Face mesh");
	const method = tile("Click method");

	const st = engine.settings;
	const tiltValue = h("span", { class: "d-tile__value" }, "");
	const setTilt = (v) => {
		if (!st?.has?.("headTrackingTiltInfluence")) return;
		st.set("headTrackingTiltInfluence", Math.round(Math.min(1, Math.max(0, v)) * 10) / 10);
		setText(tiltValue, `${Math.round(st.get("headTrackingTiltInfluence") * 100)}%`);
	};
	const copied = h("span", { class: "d-tile__note", "aria-live": "polite" }, "");
	const page = h("section", { class: "d-page", "aria-label": "Diagnostics" },
		h("header", { class: "d-page__head" },
			h("h1", { class: "d-page__title" }, "Diagnostics"),
			h("p", { class: "d-page__line" }, "How well VISION sees you right now.")),
		h("div", { class: "d-page__grid" },
			h("div", { class: "panel d-page__vf" }, vfHost),
			h("div", { class: "d-page__side" },
				h("div", { class: "card" }, h("div", { class: "card__head" }, h("h2", { class: "d-title" }, "Gestures"), h("span", { class: "d-tile__note" }, "The bar turns orange when it passes the marker")), metersHost),
				h("div", { class: "d-tiles" }, fps.el, light.el, confidence.el, head.el, mesh.el, method.el),
				h("div", { class: "card d-dev" },
					h("div", { class: "d-dev__row" },
						h("span", { class: "d-tile__name" }, "Tilt to point"),
						h("button", { class: "btn", "data-dwell": true, "aria-label": "Less tilt to point", onclick: () => setTilt(st.get("headTrackingTiltInfluence") - 0.1) }, "−"),
						tiltValue,
						h("button", { class: "btn", "data-dwell": true, "aria-label": "More tilt to point", onclick: () => setTilt(st.get("headTrackingTiltInfluence") + 0.1) }, "+"),
						h("div", { class: "session__spacer" }),
						h("button", { class: "btn", "data-dwell": true, onclick: () => copy() }, "Copy diagnostics"),
						copied),
				),
			),
		),
	);
	el.append(page);
	if (st?.has?.("headTrackingTiltInfluence")) setText(tiltValue, `${Math.round(st.get("headTrackingTiltInfluence") * 100)}%`);
	else setText(tiltValue, "–");

	const viewfinder = createViewfinder(vfHost, { engine, readouts: false, guide: false, hint: false, mesh: true });
	const meters = createMeters(metersHost, { diagnostics: true });

	function copy() {
		const text = diagnosticsText(engine.getState(), readDiagnostics(engine.getState(), lastDiag, st));
		Promise.resolve(navigator.clipboard?.writeText(text)).then(() => setText(copied, "Copied"), () => setText(copied, "Could not copy"));
	}

	let raf = 0;
	let lastText = 0;
	const loop = () => {
		raf = requestAnimationFrame(loop);
		const state = engine.getState();
		viewfinder.update(state, engine.getFrame());
		meters.update(state);
		const now = performance.now();
		if (now - lastText < 100) return; // numbers at 10 Hz, like the diag stream
		lastText = now;
		const d = readDiagnostics(state, lastDiag, st);
		setText(fps.value, Number.isFinite(d.fps) ? `${Math.round(d.fps)} fps` : "–");
		setText(fps.note, state.camera?.width ? `${state.camera.width}×${state.camera.height}` : "");
		setText(light.value, d.lightLevel ?? "–");
		setText(light.note, d.light !== null ? `${d.light} of 255` : "");
		light.el.classList.toggle("is-low", d.lightLevel === "Low");
		setText(confidence.value, d.confidence !== null ? `${d.confidence}%` : "–");
		setText(confidence.note, state.faceFound ? "face found" : "finding your face…");
		setText(head.value, `${signed(-d.pose.yaw, 0)}° ${signed(d.pose.pitch, 0)}°`);
		setText(head.note, `turn, tilt · roll ${signed(d.pose.roll, 0)}°`);
		setText(mesh.value, Number.isFinite(d.facemeshHz) ? `${d.facemeshHz} Hz` : "–");
		setText(mesh.note, `${d.points} flow points`);
		setText(method.value, d.clickMethod);
	};
	loop();

	return {
		el: page,
		destroy() {
			cancelAnimationFrame(raf);
			unsubscribe?.();
			viewfinder.destroy();
			page.remove();
		},
	};
}
