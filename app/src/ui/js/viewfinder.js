// The Viewfinder: live camera (mirrored, darkened) with a soft dot-mesh overlay, drawn from
// the engine API only (engine.getVideoStream / getFrame / getState).
//
// Mesh look (UX spec 6): about 70 small ember points on the eyes, brows, lips and jaw outline,
// 60 % opacity fading toward the edge of the face, with a 200 ms trail. No lines. Drawing only:
// the tracker's points are untouched. Hidden when the showMesh setting is off, unless the
// caller forces it on (Diagnostics). A dashed framing guide helps centring the face.

import { h, setText, signed } from "./dom.js";
import { cameraProblem } from "./recovery.js";
import { meshPoints, pointAlpha } from "./face-mesh.js";

// Ideal face position, in normalised frame coordinates (unmirrored).
const GUIDE = { cx: 0.5, cy: 0.47, rx: 0.165, ry: 0.3 };

const TRAIL_MS = 200;
const POINT_R = 1.1; // 468 landmarks: smaller points keep the mesh soft

// `pausedMessage: false`: calibration freezes the cursor on purpose, so no "paused" banner.
// `mesh`: true / false, or undefined to follow the showMesh setting (default on).
export function createViewfinder(container, { engine, readouts = true, guide = true, hint = true, pausedMessage = true, mesh: meshOption }) {
	const meshOn = () => meshOption ?? (engine.settings?.has?.("showMesh") ? engine.settings.get("showMesh") !== false : true);
	let trail = [];
	container.classList.add("viewfinder");
	const video = h("video", { autoplay: true, muted: true, playsInline: true });
	video.muted = true;
	const canvas = h("canvas", { class: "vf-overlay" });
	const ctx = canvas.getContext("2d");
	const vignette = h("div", { class: "vf-vignette" });
	const crop = h("div", { class: "crop-marks" });

	const corner = (cls, label) => {
		const value = h("span", { class: "dot-num" }, "--");
		const el = h("div", { class: `vf-corner ${cls}` }, h("span", { class: "label" }, label), value);
		return { el, value };
	};
	const yaw = corner("vf-corner--tl", "YAW");
	const pitch = corner("vf-corner--tr", "PITCH");
	const roll = corner("vf-corner--bl", "ROLL");
	const pts = corner("vf-corner--br", "FLOW PTS");
	const pillText = h("span", {}, "");
	const pill = h("div", { class: "vf-pill", hidden: true }, h("b", { class: "vf-pill__dot" }), pillText);
	const retry = h("button", { class: "btn", "data-dwell": true, hidden: true, onclick: () => engine.useCamera() }, "Try now");
	const message = h("div", { class: "vf-message", hidden: true },
		h("div", { class: "vf-message__word" }, ""),
		h("div", { class: "vf-message__text" }, ""),
		retry,
	);
	const toastEl = h("div", { class: "vf-toast", "aria-live": "polite" }, "");

	container.append(
		video,
		vignette,
		canvas,
		crop,
		...(readouts ? [yaw.el, pitch.el, roll.el, pts.el] : []),
		...(hint ? [pill] : []),
		message,
		toastEl,
	);

	let stream = null;
	let shown = true;
	function syncStream() {
		const next = engine.getVideoStream();
		if (next !== stream) {
			stream = next;
			video.srcObject = next;
			if (next && shown) {
				video.play().catch(() => { });
			}
		}
		container.classList.toggle("is-video", Boolean(stream));
	}

	let width = 0, height = 0, dpr = 1;
	// Theme colours, re-read only when the theme changes (getComputedStyle per frame is costly).
	let cachedColors = null;
	let cachedTheme = null;
	const colors = () => {
		const theme = document.documentElement.dataset.theme;
		if (!cachedColors || theme !== cachedTheme) {
			const style = getComputedStyle(container);
			cachedTheme = theme;
			cachedColors = {
				ember: style.getPropertyValue("--ember").trim() || "#FF5A1F",
				bone: style.getPropertyValue("--bone").trim() || "#F2EDE4",
				hairline: style.getPropertyValue("--rule-strong").trim() || "rgba(242,237,228,.18)",
			};
		}
		return cachedColors;
	};
	const resizeObserver = new ResizeObserver(() => {
		const rect = container.getBoundingClientRect();
		dpr = window.devicePixelRatio || 1;
		width = rect.width;
		height = rect.height;
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
	});
	resizeObserver.observe(container);

	// Smoothed pill text so it does not flicker between hints.
	let shownHint = "";
	let shownOk = false;
	let hintSince = 0;

	function draw(state, frame) {
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);
		if (!frame || !frame.width || !frame.height) {
			return;
		}
		// object-fit: cover mapping from camera pixels to panel pixels
		const scale = Math.max(width / frame.width, height / frame.height);
		const ox = (width - frame.width * scale) / 2;
		const oy = (height - frame.height * scale) / 2;
		const mirror = frame.mirror;
		const X = (x) => mirror ? width - (ox + x * scale) : ox + x * scale;
		const Y = (y) => oy + y * scale;
		const paused = Boolean(state?.paused);
		// On live video the mesh stays light in both themes (it sits on the picture).
		const onVideo = Boolean(stream);
		const { ember, bone: themeBone, hairline: themeHairline } = colors();
		const bone = onVideo ? "#F2EDE4" : themeBone;
		const hairline = onVideo ? "rgba(242,237,228,.32)" : themeHairline;

		// Framing guide: dashed hairline ellipse + four crosshair ticks outside it
		if (guide && state?.camera?.status === "on") {
			const gx = X(GUIDE.cx * frame.width);
			const gy = Y(GUIDE.cy * frame.height);
			const rx = GUIDE.rx * frame.width * scale;
			const ry = GUIDE.ry * frame.height * scale;
			ctx.save();
			ctx.strokeStyle = hairline;
			ctx.lineWidth = 1.2;
			ctx.setLineDash([2, 6]);
			ctx.beginPath();
			ctx.ellipse(gx, gy, rx, ry, 0, 0, Math.PI * 2);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.beginPath();
			ctx.moveTo(gx - rx * 1.33, gy);
			ctx.lineTo(gx - rx * 1.12, gy);
			ctx.moveTo(gx + rx * 1.12, gy);
			ctx.lineTo(gx + rx * 1.33, gy);
			ctx.moveTo(gx, gy - ry * 1.17);
			ctx.lineTo(gx, gy - ry * 1.07);
			ctx.moveTo(gx, gy + ry * 1.07);
			ctx.lineTo(gx, gy + ry * 1.17);
			ctx.stroke();
			ctx.restore();
		}

		if (!meshOn()) {
			trail = [];
			return;
		}
		const now = performance.now();
		const pts = meshPoints(frame).map(([x, y]) => [X(x), Y(y)]);
		trail = trail.filter((t) => now - t.at < TRAIL_MS);
		if (pts.length) trail.push({ at: now, pts });
		if (!trail.length) return;
		// Fade centre and radius from the newest set of points.
		const latest = trail.at(-1).pts;
		let cx = 0, cy = 0;
		for (const [x, y] of latest) { cx += x; cy += y; }
		cx /= latest.length;
		cy /= latest.length;
		let radius = 1;
		for (const [x, y] of latest) radius = Math.max(radius, Math.hypot(x - cx, y - cy));
		const dim = paused ? 0.35 : 1;
		ctx.save();
		ctx.fillStyle = paused ? bone : ember;
		for (const { at, pts: set } of trail) {
			const age = set === latest ? 1 : 0.5 * (1 - (now - at) / TRAIL_MS);
			for (const [x, y] of set) {
				ctx.globalAlpha = dim * age * pointAlpha(x, y, cx, cy, radius);
				ctx.beginPath();
				ctx.arc(x, y, POINT_R, 0, Math.PI * 2);
				ctx.fill();
			}
		}
		ctx.restore();
	}

	function update(state, frame) {
		syncStream();
		video.classList.toggle("is-mirrored", Boolean(frame?.mirror ?? true));
		if (readouts && state) {
			// Displayed from the user's point of view: right / up / clockwise positive.
			setText(yaw.value, `${signed(-state.pose.yaw)}°`);
			setText(pitch.value, `${signed(state.pose.pitch)}°`);
			setText(roll.value, `${signed(state.pose.roll)}°`);
			setText(pts.value, String(state.points ?? 0).padStart(3, "0"));
		}
		container.classList.toggle("is-framed", Boolean(state?.framing?.ok));
		container.classList.toggle("is-paused", Boolean(state?.paused));

		// Centre message: camera problems, start-up, or paused
		const word = message.children[0];
		const text = message.children[1];
		retry.hidden = state?.status !== "camera-error";
		message.classList.toggle("vf-message--paused", state?.status === "paused");
		if (state?.status === "camera-error") {
			message.hidden = false;
			setText(word, "No camera");
			setText(text, cameraProblem(state.camera?.error));
		} else if (state?.status === "starting") {
			message.hidden = false;
			setText(word, "Starting");
			setText(text, "Opening the camera…");
		} else if (state?.status === "paused" && pausedMessage) {
			message.hidden = false;
			setText(word, "Paused");
			setText(text, state.gestures?.sleep?.enabled
				? "Close both eyes for 2 seconds to resume."
				: "Say “Vision, resume” to start the cursor again.");
		} else if (state?.status === "no-face") {
			message.hidden = false;
			setText(word, "");
			setText(text, "Finding your face…");
		} else {
			message.hidden = true;
		}

		// "● FRAMED" pill: green dot when framed, ember dot + the hint when not
		if (hint && state) {
			const live = state.status === "tracking" || state.status === "no-face";
			const ok = Boolean(state.framing?.ok);
			const wanted = live ? (ok ? "FRAMED" : state.framing?.hint ?? "") : "";
			const now = performance.now();
			if ((wanted !== shownHint || ok !== shownOk) && now - hintSince > 600) {
				shownHint = wanted;
				shownOk = ok;
				hintSince = now;
				pill.dataset.ok = String(ok);
				setText(pillText, wanted);
			}
			pill.hidden = !shownHint;
		}
		draw(state, frame);
	}

	let toastTimer = 0;
	/** Small ember pill at the top centre, e.g. "Left click". */
	function toast(text, ms = 1200) {
		toastEl.textContent = text;
		toastEl.classList.add("is-on");
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), ms);
	}

	return {
		update,
		/** Show or hide the mesh (null: follow the showMesh setting). */
		setMesh(on) { meshOption = on ?? undefined; },
		toast,
		/** Off screen: stop decoding the preview video (the engine has its own). */
		setShown(on) {
			shown = on;
			if (on) video.play().catch(() => { });
			else video.pause();
		},
		destroy() {
			clearTimeout(toastTimer);
			resizeObserver.disconnect();
			video.srcObject = null;
			container.replaceChildren();
			container.classList.remove("viewfinder", "is-video", "is-framed", "is-paused");
		},
	};
}
export const mount = (el, ctx) => createViewfinder(el, ctx);
