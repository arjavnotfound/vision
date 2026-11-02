/* global Vision, electronAPI */

let audio = null;

Vision.dependenciesRoot = "../node_modules/vision-hft";

// I like bigButton and I cannot lie
const bigButton = document.createElement("button");
bigButton.style.position = "absolute";
bigButton.style.top = "0";
bigButton.style.left = "0";
bigButton.style.width = "100%";
bigButton.style.height = "100%";
bigButton.style.backgroundColor = "transparent";
bigButton.style.border = "none";
bigButton.id = "button-that-takes-up-the-entire-screen";
document.body.appendChild(bigButton);

// Desktop dwell drag (setting "dwellDrag", off by default):
// first dwell presses the primary button, the next dwell releases it.
let dwellDragEnabled = false;
let heldByDwell = false;
let heldSince = 0;
let dwellTimeMs = 500;

window.addEventListener("pointerdown", (event) => {
	if (!dwellDragEnabled || heldByDwell || event.target !== bigButton) {
		return;
	}
	heldByDwell = true;
	heldSince = performance.now();
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
	// Releasing is always allowed by the main process.
	electronAPI.dwellMouseButton(false);
});
function releaseDwellDragLocally() {
	heldByDwell = false;
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
	click: ({ x, y }) => {
		electronAPI.mouseClick(x, y);

		audio?.playSound("clickPress");
		setTimeout(() => audio?.playSound("clickRelease"), 100);
	},
});

const screenOverlay = Vision.initScreenOverlay();

electronAPI.onMouseMove((_event, x, y) => {
	// console.log("moveMouse", x, y);
	document.dispatchEvent(new Event("mouseenter"));
	const domEvent = new PointerEvent("pointermove", {
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
	});
	window.dispatchEvent(domEvent);
	screenOverlay.updateMousePos(x, y);
});

let wasDwellClickerEnabled = false;
electronAPI.onOverlayUpdate((_event, data) => {
	// console.log("onOverlayUpdate", data);
	const { isEnabled, clickingMode, soundEffectsEnabled, heldButtons } = data;
	dwellDragEnabled = Boolean(data.dwellDrag);
	if (Number.isFinite(data.dwellTime) && data.dwellTime > 0) {
		dwellTimeMs = data.dwellTime;
	}
	// If the main process released the button (pause, F9, manual takeover, ...),
	// drop our local drag state too. Small grace period for the press round-trip.
	if (heldByDwell && heldButtons && !heldButtons.left && !heldButtons.right && performance.now() - heldSince > 300) {
		releaseDwellDragLocally();
	}

	screenOverlay.update(data);

	// "Trick" V.I.S.I.O.N. into stopping/starting the dwell clicker.
	// Update: I'm now setting `dwellClicker.paused`, just keeping the event dispatching
	// in case it's needed to cancel a dwell click in progress.
	// TODO: ensure setting `paused` to `true` cancels any in-progress dwell click.
	const dwellClickerEnabled = isEnabled && clickingMode === "dwell";
	if (wasDwellClickerEnabled !== dwellClickerEnabled) {
		document.dispatchEvent(new Event(dwellClickerEnabled ? "mouseenter" : "mouseleave"));
		window.dispatchEvent(new Event(dwellClickerEnabled ? "focus" : "blur"));
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
