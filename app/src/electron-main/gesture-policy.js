// Which face-gesture inputs may reach the desktop right now. Pure, unit tested.
//
// Two rules sit on top of the engine (which itself is unchanged):
//   1. Voice on: while the assistant's mic is live, talking opens the mouth, so the
//      mouth gestures (click/hold in the Mouth modes, and mouth + tilt scrolling) are
//      suppressed. Head movement, winks and dwell keep working.
//   2. Adaptive control map: a gesture that calibration found unreliable for this person
//      is switched off (for now: the right wink in Wink mode, when right click moved to
//      raised brows or to the voice).
// Releasing a button is ALWAYS allowed, so nothing can ever stay held because of this.

const MOUTH_CLICK_MODES = new Set(['open-mouth', 'open-mouth-simple', 'open-mouth-ignoring-eyes']);

function isMouthClickMode(clickingMode) {
	return MOUTH_CLICK_MODES.has(clickingMode);
}

/**
 * @param {object} args
 * @param {number} args.button 0 left, 1 middle, 2 right
 * @param {boolean} args.down
 * @param {string} args.clickingMode
 * @param {boolean} args.voiceLive
 * @param {object} [args.controlMap] stored mapping ({ rightClick: 'rightWink'|'brow'|'voice', ... })
 * @returns {{allowed: boolean, reason?: string}}
 */
function allowGestureButton({ button, down, clickingMode, voiceLive, controlMap }) {
	if (!down) {
		return { allowed: true };
	}
	if (voiceLive && isMouthClickMode(clickingMode)) {
		return { allowed: false, reason: 'voice-on' };
	}
	if (clickingMode === 'blink' && button === 2 && controlMap?.rightClick && controlMap.rightClick !== 'rightWink') {
		return { allowed: false, reason: 'right-wink-remapped' };
	}
	return { allowed: true };
}

/** Mouth + head-tilt scrolling. */
function allowGestureScroll({ voiceLive, controlMap }) {
	if (voiceLive) {
		return { allowed: false, reason: 'voice-on' };
	}
	if (controlMap?.scroll && controlMap.scroll !== 'mouth') {
		return { allowed: false, reason: 'scroll-remapped' };
	}
	return { allowed: true };
}

module.exports = { allowGestureButton, allowGestureScroll, isMouthClickMode };
