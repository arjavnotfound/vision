// Maps detected gestures to mouse actions, per clicking mode. Extracted unchanged.

export const SCROLL_PITCH_THRESHOLD_DEG = 5;

/**
 * Mouth open + head tilted up/down scrolls.
 * @param {boolean} mouthOpen mouth threshold met
 * @param {{pitch: number}} headTilt radians
 * @param {number} pitchOffset radians (setting headTiltPitchOffset)
 * @returns {-1|0|1} -1 = scroll up, 1 = scroll down
 */
export function mouthScrollDirection(mouthOpen, headTilt, pitchOffset) {
	if (!mouthOpen || !headTilt) {
		return 0;
	}
	const pitchDeg = (headTilt.pitch || 0) * 180 / Math.PI;
	const pitchOffsetDeg = (pitchOffset ? pitchOffset * 180 / Math.PI : 0);
	const relativePitch = pitchDeg - pitchOffsetDeg;
	if (relativePitch > SCROLL_PITCH_THRESHOLD_DEG) {
		return -1; // tilted up -> scroll up
	} else if (relativePitch < -SCROLL_PITCH_THRESHOLD_DEG) {
		return 1; // tilted down -> scroll down
	}
	return 0;
}

/**
 * Decides which mouse button (if any) the face is holding down.
 * NOTE: like the original inline code, this MUTATES blinkInfo/mouthInfo
 * (`used`, and `active` in the open-mouth modes) because the HUD draws from them.
 *
 * @param {object} args
 * @param {string} args.clickingMode
 * @param {object} args.blinkInfo result of detectBlinks
 * @param {object} args.mouthInfo result of detectMouthOpen
 * @param {boolean} args.prevMouthOpen mouth state on the previous estimate
 * @param {boolean} args.isMouthScrolling
 * @param {number} args.mouseButtonUntilMouthCloses latched button for open-mouth modes
 * @returns {{clickButton: number, mouseButtonUntilMouthCloses: number}} clickButton: -1 none, 0 left, 1 middle, 2 right
 */
export function resolveClickButton({ clickingMode, blinkInfo, mouthInfo, prevMouthOpen, isMouthScrolling, mouseButtonUntilMouthCloses }) {
	blinkInfo.used = false;
	mouthInfo.used = false;
	let clickButton = -1;
	if (clickingMode === "blink") {
		blinkInfo.used = true;
		if (blinkInfo.leftEye.active) {
			clickButton = 0; // Left Click
		} else if (blinkInfo.rightEye.active) {
			clickButton = 2; // Right Click
		}
	}
	if (clickingMode === "open-mouth-ignoring-eyes") {
		mouthInfo.used = true;
		if (mouthInfo.thresholdMet) {
			clickButton = isMouthScrolling ? -1 : 0;
		}
	}
	if (clickingMode === "open-mouth" || clickingMode === "open-mouth-simple") {
		mouthInfo.used = true;
		blinkInfo.used = true;
		const allowModifiers = clickingMode !== "open-mouth-simple";
		// Modifiers with eye closing trigger different buttons, making this a three-button mouse.
		if (mouthInfo.thresholdMet && !prevMouthOpen) {
			if (blinkInfo.rightEye.active && allowModifiers) {
				mouseButtonUntilMouthCloses = 1;
			} else if (blinkInfo.leftEye.active && allowModifiers) {
				mouseButtonUntilMouthCloses = 2;
			} else if (!blinkInfo.rightEye.open && !blinkInfo.leftEye.open) {
				mouseButtonUntilMouthCloses = -1;
			} else {
				mouseButtonUntilMouthCloses = 0;
			}
		}
		if (mouthInfo.thresholdMet) {
			clickButton = isMouthScrolling ? -1 : mouseButtonUntilMouthCloses;
			if (clickButton === -1 && !isMouthScrolling) {
				// Show as passive / not clicking in visuals
				mouthInfo.active = false;
			}
		}
		if (mouthInfo.thresholdMet || clickingMode === "open-mouth-simple") {
			blinkInfo.rightEye.active = clickButton === 1;
			blinkInfo.leftEye.active = clickButton === 2;
		}
	}
	return { clickButton, mouseButtonUntilMouthCloses };
}
