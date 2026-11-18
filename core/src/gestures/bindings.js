// Human-readable gesture -> action mapping for the current settings.
// Single source of truth for what each gesture does, used by the UI's gesture meters.
// (Mirrors chooseClickButton / mouthScrollDirection; tested together.)

import { clickMethods } from "./arbitration.js";

export const GESTURES = ["leftWink", "rightWink", "mouth", "brow", "sleep"];

/**
 * @param {object} settings engine settings (clickWink, clickBlink, clickMouth, clickDwell, pauseMethod, mouthTiltScroll, eyebrowRaiseOpensKeyboard)
 * @returns {Record<string, string>} gesture -> short action label (uppercase), "OFF" when unused
 */
export function gestureBindings(settings = {}) {
	const methods = clickMethods(settings);
	const tiltScroll = settings.mouthTiltScroll !== false;
	return {
		leftWink: methods.wink ? "LEFT CLICK" : "OFF",
		rightWink: methods.wink ? "RIGHT CLICK" : "OFF",
		blink: methods.blink ? "LEFT CLICK" : "OFF",
		mouth: methods.mouth ? (tiltScroll ? "CLICK · TILT SCROLL" : "LEFT CLICK") : (tiltScroll ? "SCROLL (TILT)" : "OFF"),
		brow: settings.eyebrowRaiseOpensKeyboard !== false ? "KEYBOARD" : "OFF",
		sleep: settings.pauseMethod === "closeEyes" ? "PAUSE" : "OFF",
		tripleBlink: settings.pauseMethod === "closeEyes" ? "OFF" : "PAUSE",
	};
}

/**
 * Plain-language list of the click methods that are on, e.g. "Wink, Dwell".
 * Accepts the settings object (or, for old callers, nothing useful: then the defaults).
 */
export function clickingModeLabel(settings) {
	const methods = clickMethods(typeof settings === "object" && settings ? settings : {});
	const names = [["wink", "Wink"], ["blink", "Blink"], ["mouth", "Mouth"], ["dwell", "Dwell"]]
		.filter(([key]) => methods[key]).map(([, name]) => name);
	return names.length ? names.join(", ") : "No click method";
}
