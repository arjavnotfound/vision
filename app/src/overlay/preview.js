// Overlay states for --preview screenshots (no Electron IPC, no dwell clicker).

import { createOverlayView } from "./view.js";

const state = new URLSearchParams(location.search).get("state") || "tracking";
const view = createOverlayView();
const cursor = document.getElementById("os-cursor");

const at = { x: 620, y: 300 };
if (state === "drag") {
	at.x = 470;
	at.y = 240;
}
view.moveTo(at.x, at.y);
cursor.style.left = `${at.x}px`;
cursor.style.top = `${at.y}px`;

switch (state) {
	case "dwell":
		view.setMode("tracking");
		view.setDwell(0.66);
		break;
	case "click":
		view.setMode("tracking");
		view.pulse("L");
		view.showTag("L", { ember: true, ms: 0 }); // keep the 400 ms label visible for the still
		// Freeze the pulse mid-animation for the screenshot.
		setTimeout(() => document.getAnimations().forEach((a) => { a.currentTime = 120; a.pause(); }), 30);
		break;
	case "drag":
		view.setMode("tracking");
		view.setHolding(true);
		view.pulse("DRAG");
		view.setDwell(0.35, true);
		setTimeout(() => document.getAnimations().forEach((a) => a.finish()), 30);
		break;
	case "paused":
		view.setMode("paused");
		break;
	case "no-face":
		view.setMode("noface");
		break;
	default:
		view.setMode("tracking");
}

document.fonts.ready.then(() => setTimeout(() => { window.__visionReady = true; }, 250));
