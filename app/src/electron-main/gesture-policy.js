// Which face-gesture inputs may reach the desktop right now. Pure, unit tested.
//
// Two rules sit on top of the engine (which itself is unchanged):
//   1. Voice on: while the assistant's mic is live, talking opens the mouth, so the
//      mouth gestures (the Mouth click method, and mouth + tilt scrolling) are
//      suppressed. Head movement, winks and dwell keep working: a left-button press
//      while the left eye is shut is a wink, so it passes.
//   2. Adaptive control map: a gesture that calibration found unreliable for this person
//      is switched off (for now: the right wink, when right click moved to raised brows
//      or to the voice).
// Releasing a button is ALWAYS allowed, so nothing can ever stay held because of this.

/** The Mouth click method is on. */
function isMouthClickMode(settings) {
	return settings?.clickMouth === true;
}

/**
 * @param {object} args
 * @param {number} args.button 0 left, 1 middle, 2 right
 * @param {boolean} args.down
 * @param {boolean} args.mouthClick the Mouth click method is on
 * @param {boolean} [args.leftEyeClosed] latest eye state: the left eye is shut (a left wink)
 * @param {boolean} args.voiceLive
 * @param {object} [args.controlMap] stored mapping ({ rightClick: 'rightWink'|'brow'|'voice', ... })
 * @returns {{allowed: boolean, reason?: string}}
 */
function allowGestureButton({ button, down, mouthClick, leftEyeClosed = false, voiceLive, controlMap }) {
	if (!down) {
		return { allowed: true };
	}
	if (voiceLive && mouthClick && button === 0 && !leftEyeClosed) {
		return { allowed: false, reason: 'voice-on' };
	}
	// Right button only ever comes from the right wink.
	if (button === 2 && controlMap?.rightClick && controlMap.rightClick !== 'rightWink') {
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
