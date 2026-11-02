// Human-readable gesture -> action mapping for the current settings.
// Single source of truth for what each gesture does, used by the UI's gesture meters.
// (Mirrors resolveClickButton / mouthScrollDirection; tested together.)

export const GESTURES = ["leftWink", "rightWink", "mouth", "brow", "sleep"];

/**
 * @param {object} settings engine settings (clickingMode, mouthTiltScroll, eyebrowRaiseOpensKeyboard, closeEyesToToggle)
 * @returns {Record<string, string>} gesture -> short action label (uppercase), "OFF" when unused
 */
export function gestureBindings(settings) {
	const mode = settings.clickingMode;
	const tiltScroll = settings.mouthTiltScroll !== false;
	const bindings = {
		leftWink: "OFF",
		rightWink: "OFF",
		mouth: tiltScroll ? "SCROLL (TILT)" : "OFF",
		brow: settings.eyebrowRaiseOpensKeyboard !== false ? "KEYBOARD" : "OFF",
		sleep: settings.closeEyesToToggle ? "PAUSE" : "OFF",
	};
	switch (mode) {
		case "blink":
			bindings.leftWink = "LEFT CLICK";
			bindings.rightWink = "RIGHT CLICK";
			break;
		case "open-mouth-simple":
			bindings.mouth = tiltScroll ? "CLICK · TILT SCROLL" : "LEFT CLICK";
			break;
		case "open-mouth":
			bindings.mouth = "LEFT CLICK";
			// With the mouth open: left eye closed = right button, right eye closed = middle button.
			bindings.leftWink = "+MOUTH: RIGHT";
			bindings.rightWink = "+MOUTH: MIDDLE";
			break;
		case "open-mouth-ignoring-eyes":
			bindings.mouth = "HOLD LEFT";
			break;
		case "dwell":
		case "off":
		default:
			break;
	}
	return bindings;
}

/** Plain-language name of a clicking mode. */
export function clickingModeLabel(mode) {
	return {
		"blink": "Wink to click",
		"open-mouth-simple": "Open mouth to click",
		"open-mouth": "Mouth + wink (3 buttons)",
		"open-mouth-ignoring-eyes": "Open mouth to hold",
		"dwell": "Dwell to click",
		"off": "Clicking off",
	}[mode] || String(mode || "");
}
