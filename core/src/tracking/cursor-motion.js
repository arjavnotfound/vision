// Cursor motion from optical-flow movement: acceleration curve, optional head-tilt
// influence, motion threshold, and drag-delay lock. Extracted from vision.js unchanged.

/** Power-law acceleration: delta * |5·delta|^acceleration. */
export function accelerate(delta, acceleration) {
	return (delta / 1) * (Math.abs(delta * 5) ** acceleration);
}

/**
 * @param {object} args
 * @param {number} args.movementX mean optical-flow movement (camera pixels/frame)
 * @param {number} args.movementY
 * @param {object} args.s settings
 * @param {{yaw:number, pitch:number}} args.headTilt radians
 * @param {number} args.mouseX current cursor position
 * @param {number} args.mouseY
 * @param {number} args.screenWidth
 * @param {number} args.screenHeight
 * @param {number} args.timeSinceMouseDown ms
 * @returns {{deltaX:number, deltaY:number}} fractions of the screen size
 */
export function computeCursorDelta({ movementX, movementY, s, headTilt, mouseX, mouseY, screenWidth, screenHeight, timeSinceMouseDown }) {
	let deltaX = accelerate(movementX * s.headTrackingSensitivityX, s.headTrackingAcceleration);
	let deltaY = accelerate(movementY * s.headTrackingSensitivityY, s.headTrackingAcceleration);

	if (s.headTrackingTiltInfluence > 0) {
		const yawRange = [
			s.headTiltYawOffset - s.headTiltYawRange / 2,
			s.headTiltYawOffset + s.headTiltYawRange / 2
		];
		const pitchRange = [
			s.headTiltPitchOffset - s.headTiltPitchRange / 2,
			s.headTiltPitchOffset + s.headTiltPitchRange / 2
		];

		const normalize = (value, min, max) => (value - min) / (max - min);

		const targetX = screenWidth * (1 - normalize(headTilt.yaw, yawRange[0], yawRange[1]));
		const targetY = screenHeight * normalize(headTilt.pitch, pitchRange[0], pitchRange[1]);

		const deltaXToMatchTilt = (mouseX - targetX) / screenWidth;
		const deltaYToMatchTilt = (targetY - mouseY) / screenHeight;
		// Slow down movement away from the tilt target; past 80% influence, also pull toward it.
		const slowingInfluence = s.headTrackingTiltInfluence;
		const speedingInfluence = Math.max(0, Math.min(1, normalize(s.headTrackingTiltInfluence, 0.8, 1)));
		if (deltaX * deltaXToMatchTilt < 0) {
			deltaX *= 1 - slowingInfluence;
		} else {
			deltaX += (deltaXToMatchTilt - deltaX) * speedingInfluence;
		}
		if (deltaY * deltaYToMatchTilt < 0) {
			deltaY *= 1 - slowingInfluence;
		} else {
			deltaY += (deltaYToMatchTilt - deltaY) * speedingInfluence;
		}
	}

	// eViacam-style motion threshold (per axis, in screen pixels, after acceleration).
	if (Math.abs(deltaX * screenWidth) < s.headTrackingMinDistance) {
		deltaX = 0;
	}
	if (Math.abs(deltaY * screenHeight) < s.headTrackingMinDistance) {
		deltaY = 0;
	}
	// Avoid dragging when trying to click: hold still briefly after a mouse down.
	if (timeSinceMouseDown < s.delayBeforeDragging) {
		deltaX = 0;
		deltaY = 0;
	}
	return { deltaX, deltaY };
}
