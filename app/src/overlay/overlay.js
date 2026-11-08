// Desktop overlay (Electron glue): dwell clicking over the whole screen, plus the cursor
// halo / dwell ring / click pulse view. The window is click-through.

/* global Vision, electronAPI */

import { createOverlayView } from "./view.js";

let audio = null;
Vision.dependenciesRoot = "../../node_modules/vision-hft";

const view = createOverlayView();

// A full-screen button: the dwell clicker's only target. Clicks go to the OS via IPC.
const bigButton = document.createElement("button");
bigButton.id = "button-that-takes-up-the-entire-screen";
bigButton.tabIndex = -1;
document.body.appendChild(bigButton);

// Desktop dwell drag (setting "dwellDrag", off by default):
// first dwell presses the primary button, the next dwell releases it.
let dwellDragEnabled = false;
let heldByDwell = false;
let heldSince = 0;
let dwellTimeMs = 800;

window.addEventListener("pointerdown", (event) => {
	if (!dwellDragEnabled || heldByDwell || event.target !== bigButton) {
		return;
	}
	heldByDwell = true;
	heldSince = performance.now();
	view.setHolding(true);
	electronAPI.dwellMouseButton(true, event.clientX, event.clientY).then((pressed) => {
		if (!pressed) {
			releaseDwellDragLocally();
		}
	}, releaseDwellDragLocally);
});
window.addEventListener("pointerup", () => {
	if (!heldByDwell) {
		return;
	}
	heldByDwell = false;
	view.setHolding(false);
	// Releasing is always allowed by the main process.
	electronAPI.dwellMouseButton(false);
});
function releaseDwellDragLocally() {
	heldByDwell = false;
	view.setHolding(false);
	view.hideTag();
	// Resets the dwell clicker's internal drag state without sending another release.
	window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1234567890, bubbles: true }));
}

const dwellClicker = Vision.initDwellClicking({
	targets: "#button-that-takes-up-the-entire-screen",
	noCenter: (el) => el.matches("#button-that-takes-up-the-entire-screen"),
	hoverTimespan: () => dwellTimeMs,
	shouldDrag: () => dwellDragEnabled,
	isHeld: () => heldByDwell,
	// A long head sweep is a normal part of dragging across the desktop.
	releaseDragOnFastMovement: false,
	onDwellProgress: ({ progress, forRelease }) => view.setDwell(progress, forRelease),
	click: ({ x, y }) => {
		electronAPI.mouseClick(x, y);
		audio?.playSound("clickPress");
		setTimeout(() => audio?.playSound("clickRelease"), 100);
	},
});

electronAPI.onMouseMove((_event, x, y) => {
	document.dispatchEvent(new Event("mouseenter"));
	window.dispatchEvent(new PointerEvent("pointermove", {
		view: window,
		clientX: x,
		clientY: y,
		pointerId: 1,
		pointerType: "mouse",
		isPrimary: true,
		button: 0,
		buttons: 1,
		bubbles: true,
		cancelable: true,
	}));
	view.moveTo(x, y);
});

electronAPI.onPulse?.((_event, label) => view.pulse(label));

let wasDwellClickerEnabled = false;
electronAPI.onOverlayUpdate((_event, data) => {
	const { isEnabled, isManualTakeback, clickingMode, soundEffectsEnabled, heldButtons, systemMousePosition, inputFeedback } = data;
	dwellDragEnabled = Boolean(data.dwellDrag);
	if (Number.isFinite(data.dwellTime) && data.dwellTime > 0) {
		dwellTimeMs = data.dwellTime;
	}
	// The halo follows the real cursor (head-driven or physical).
	if (systemMousePosition) {
		view.moveTo(systemMousePosition.x, systemMousePosition.y);
	}
	view.setMode(isManualTakeback ? "takeover" : !isEnabled ? "paused" : inputFeedback?.headNotFound ? "noface" : "tracking",
		data.closeEyesToToggle ? "PAUSED · CLOSE EYES 2S" : "PAUSED · F9");

	// If the main process released the button (pause, F9, manual takeover, ...),
	// drop our local drag state too. Small grace period for the press round-trip.
	if (heldByDwell && heldButtons && !heldButtons.left && !heldButtons.right && performance.now() - heldSince > 300) {
		releaseDwellDragLocally();
	}

	const dwellClickerEnabled = isEnabled && clickingMode === "dwell";
	if (wasDwellClickerEnabled !== dwellClickerEnabled) {
		document.dispatchEvent(new Event(dwellClickerEnabled ? "mouseenter" : "mouseleave"));
		window.dispatchEvent(new Event(dwellClickerEnabled ? "focus" : "blur"));
		if (!dwellClickerEnabled) view.setDwell(0);
	}
	dwellClicker.paused = !dwellClickerEnabled;
	wasDwellClickerEnabled = dwellClickerEnabled;

	audio?.setAudioEnabled(soundEffectsEnabled);
});

Vision._initAudio().then((module) => {
	audio = module;
}, (e) => {
	console.warn("Failed to initialize audio module, click sounds will be disabled:", e);
});
