// The Viewfinder: live camera (mirrored, darkened) with a dot-mesh overlay, drawn from the
// engine API only (engine.getVideoStream / getFrame / getState).
//
// Look (from the approved "Iris" prototype):
//   - face points are small bone dots; eye, nose and mouth points are ember
//   - hairline polylines join the eye, brow, lip and jaw contours at ~22% opacity
//   - a dashed framing ellipse with four crosshair ticks outside it
//   - an ember nose reticle (r 14) with four ticks
//   - paused: mesh dimmed to 35% and a large Doto PAUSED in the centre

import { h, setText, signed } from "./dom.js";

// Ideal face position, in normalised frame coordinates (unmirrored).
const GUIDE = { cx: 0.5, cy: 0.47, rx: 0.165, ry: 0.3 };

/** Build a drawable mesh from the engine's real contours and optical-flow points. */
function meshFromContours(frame) {
	const c = frame.contours || {};
	const pts = [];
	const lines = [];
	const addLoop = (points, key, closed) => {
		if (!points || points.length < 2) return;
		const start = pts.length;
		for (const [x, y] of points) pts.push([x, y, 0, key]);
		for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
			lines.push([start + i, start + ((i + 1) % points.length)]);
		}
	};
	const eye = (upper, lower) => (upper && lower && lower.length > 1) ? [...lower, ...[...upper].reverse()] : null;
	addLoop(c.silhouette, false, true);
	addLoop(c.leftEyebrowUpper, false, false);
	addLoop(c.rightEyebrowUpper, false, false);
	addLoop(eye(c.leftEyeUpper0, c.leftEyeLower0), true, true);
	addLoop(eye(c.rightEyeUpper0, c.rightEyeLower0), true, true);
	addLoop(eye(c.lipsUpperInner, c.lipsLowerInner), true, true);
	// Optical-flow points sit on the nose: ember dots, no lines.
	const p = frame.points;
	for (let i = 0; i < (frame.pointCount || 0); i++) {
		pts.push([p[i * 2], p[i * 2 + 1], 0, true]);
	}
	return { pts, lines, nose: frame.nose };
}

// `pausedMessage: false`: calibration freezes the cursor on purpose, so no "paused" banner.
export function createViewfinder(container, { engine, readouts = true, guide = true, hint = true, pausedMessage = true }) {
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
	const retry = h("button", { class: "btn", "data-dwell": true, hidden: true, onclick: () => engine.useCamera() }, "Retry camera");
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
	function syncStream() {
		const next = engine.getVideoStream();
		if (next !== stream) {
			stream = next;
			video.srcObject = next;
			if (next) {
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

		const mesh = frame.mesh ?? meshFromContours(frame);
		if (!mesh.pts.length) {
			return;
		}
		const P = mesh.pts.map(([x, y, depth, key]) => [X(x), Y(y), depth || 0, key]);
		const dim = paused ? 0.35 : 1;

		// Hairline polylines (~22%)
		ctx.save();
		ctx.strokeStyle = bone;
		ctx.globalAlpha = 0.22 * dim;
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (const [a, b] of mesh.lines) {
			ctx.moveTo(P[a][0], P[a][1]);
			ctx.lineTo(P[b][0], P[b][1]);
		}
		ctx.stroke();
		ctx.restore();

		// Dots: bone, with eye / nose / mouth points in ember (bone when paused)
		ctx.save();
		for (const [x, y, depth, key] of P) {
			const r = (key ? 1.8 : 1.3) * (1 + depth * 0.4);
			ctx.globalAlpha = dim * (key ? 1 : 0.5 + depth * 0.6);
			ctx.fillStyle = key && !paused ? ember : bone;
			ctx.beginPath();
			ctx.arc(x, y, r, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();

		// Nose reticle: ember circle r 14 with four ticks
		const nose = mesh.nose;
		if (nose) {
			const nx = X(nose[0]);
			const ny = Y(nose[1]);
			ctx.save();
			ctx.strokeStyle = paused ? bone : ember;
			ctx.globalAlpha = paused ? 0.6 : 1;
			ctx.lineWidth = 1.3;
			ctx.beginPath();
			ctx.arc(nx, ny, 14, 0, Math.PI * 2);
			ctx.moveTo(nx - 22, ny);
			ctx.lineTo(nx - 9, ny);
			ctx.moveTo(nx + 9, ny);
			ctx.lineTo(nx + 22, ny);
			ctx.moveTo(nx, ny - 22);
			ctx.lineTo(nx, ny - 9);
			ctx.moveTo(nx, ny + 9);
			ctx.lineTo(nx, ny + 22);
			ctx.stroke();
			ctx.restore();
		}
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
			setText(word, "NO CAMERA");
			setText(text, state.camera?.error?.name === "NotReadableError" || state.camera?.error?.name === "TrackStartError" ?
				"The camera is busy. Close Teams, Zoom, OBS or browser tabs that use it, then retry." :
				(state.lastError?.message || "VISION could not open the camera."));
		} else if (state?.status === "starting") {
			message.hidden = false;
			setText(word, "STARTING");
			setText(text, "Opening the camera…");
		} else if (state?.status === "paused" && pausedMessage) {
			message.hidden = false;
			setText(word, "PAUSED");
			setText(text, "Your mouse is yours again. Press F9 to resume.");
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
		toast,
		destroy() {
			clearTimeout(toastTimer);
			resizeObserver.disconnect();
			video.srcObject = null;
			container.replaceChildren();
			container.classList.remove("viewfinder", "is-video", "is-framed", "is-paused");
		},
	};
}
