// VERBATIM copies of the inline tracking/gesture code from core/vision.js as of commit
// b8f546b (before extraction into core/src). Used only to pin behaviour: the extracted
// modules must produce identical outputs. Do not "fix" anything in here.

// (lint rules do not apply to this verbatim copy)

function signedDistancePointLine(point, a, b) {
	const [px, py] = point;
	const [x1, y1] = a;
	const [x2, y2] = b;

	const dx = x2 - x1;
	const dy = y2 - y1;

	// Perpendicular (normal) vector
	const nx = -dy;
	const ny = dx;

	return ((px - x1) * nx + (py - y1) * ny) / Math.hypot(nx, ny);
}

function getAspectMetrics(upperContour, lowerContour) {
	// The lower eye keypoints have the corners
	const corners = [lowerContour[0], lowerContour[lowerContour.length - 1]];
	// Excluding the corners isn't really important since their measures will be 0.
	const otherPoints = upperContour.concat(lowerContour).filter(point => !corners.includes(point));
	let highest = 0;
	let lowest = 0;
	for (const point of otherPoints) {
		const distance = signedDistancePointLine(point, corners[0], corners[1]);
		if (distance < lowest) {
			lowest = distance;
		}
		if (distance > highest) {
			highest = distance;
		}
	}

	const width = Math.hypot(
		corners[0][0] - corners[1][0],
		corners[0][1] - corners[1][1]
	);
	const height = highest - lowest;
	return {
		corners,
		upperContour,
		lowerContour,
		highest,
		lowest,
		heightRatio: height / width,
	};
}

// `blinkInfo` was a closure variable; passed explicitly here. `now` replaces performance.now().
function detectBlinks(annotations, blinkInfo, now) {
	const eyes = {
		leftEye: getAspectMetrics(annotations.leftEyeUpper0, annotations.leftEyeLower0),
		rightEye: getAspectMetrics(annotations.rightEyeUpper0, annotations.rightEyeLower0)
	};

	const thresholdHigh = 0.2;
	const thresholdLow = 0.16;
	for (const key of ["leftEye", "rightEye"]) {
		eyes[key].open = eyes[key].heightRatio > (blinkInfo?.[key].open ? thresholdLow : thresholdHigh);
	}

	// Involuntary blink rejection
	const blinkRejectDuration = 100; // milliseconds
	const currentTime = now;
	for (const key of ["leftEye", "rightEye"]) {
		if (eyes[key].open === blinkInfo?.[key].open) {
			eyes[key].timeSinceChange = blinkInfo?.[key].timeSinceChange ?? currentTime;
		} else {
			eyes[key].timeSinceChange = currentTime;
		}
	}
	const timeSinceChange = currentTime - Math.max(eyes.leftEye.timeSinceChange, eyes.rightEye.timeSinceChange);
	eyes.leftEye.active = timeSinceChange > blinkRejectDuration && eyes.rightEye.open && !eyes.leftEye.open;
	eyes.rightEye.active = timeSinceChange > blinkRejectDuration && eyes.leftEye.open && !eyes.rightEye.open;

	eyes.leftEye.thresholdMet = !eyes.leftEye.open;
	eyes.rightEye.thresholdMet = !eyes.rightEye.open;

	return eyes;
}

function detectMouthOpen(annotations, mouthInfo) {
	const prevThresholdMet = mouthInfo?.thresholdMet;
	const mouth = getAspectMetrics(annotations.lipsUpperInner, annotations.lipsLowerInner);
	const thresholdHigh = 0.25;
	const thresholdLow = 0.15;
	mouth.thresholdMet = mouth.heightRatio > (prevThresholdMet ? thresholdLow : thresholdHigh);
	mouth.active = mouth.thresholdMet; // TODO: maybe default to false, have this only set externally in gesture handling code
	return mouth;
}

function detectForeheadRaised(annotations, foreheadInfo) {
	if (!annotations?.leftEyebrowUpper || !annotations?.rightEyebrowUpper || !annotations?.leftEyeLower0 || !annotations?.rightEyeLower0) {
		return { leftRatio: 0, rightRatio: 0, avgRatio: 0, thresholdMet: false, active: false };
	}

	const pLeftEye = annotations.leftEyeLower0[0] || annotations.leftEyeUpper0?.[0];
	const pRightEye = annotations.rightEyeLower0[0] || annotations.rightEyeUpper0?.[0];
	if (!pLeftEye || !pRightEye) {
		return { leftRatio: 0, rightRatio: 0, avgRatio: 0, thresholdMet: false, active: false };
	}

	const eyeDistance = Math.hypot(pLeftEye[0] - pRightEye[0], pLeftEye[1] - pRightEye[1]);
	const refScale = Math.max(25, eyeDistance);

	let leftDistSum = 0, leftCount = 0;
	for (const pt of annotations.leftEyebrowUpper) {
		if (pt) {
			leftDistSum += Math.abs(signedDistancePointLine(pt, pLeftEye, pRightEye));
			leftCount++;
		}
	}
	let rightDistSum = 0, rightCount = 0;
	for (const pt of annotations.rightEyebrowUpper) {
		if (pt) {
			rightDistSum += Math.abs(signedDistancePointLine(pt, pLeftEye, pRightEye));
			rightCount++;
		}
	}

	const leftDist = leftCount > 0 ? (leftDistSum / leftCount) : 0;
	const rightDist = rightCount > 0 ? (rightDistSum / rightCount) : 0;

	const leftRatio = leftDist / refScale;
	const rightRatio = rightDist / refScale;
	const avgRatio = (leftRatio + rightRatio) / 2;

	const prevThresholdMet = foreheadInfo?.thresholdMet || false;
	const thresholdHigh = 0.28;
	const thresholdLow = 0.24;
	const threshold = prevThresholdMet ? thresholdLow : thresholdHigh;

	const isRaised = avgRatio > threshold && leftRatio > (threshold - 0.05) && rightRatio > (threshold - 0.05);

	return {
		leftRatio,
		rightRatio,
		avgRatio,
		thresholdMet: isRaised,
		active: isRaised
	};
}

// Head tilt from keypoints (inline block in the facemesh handler)
function computeHeadTilt(keypoints) {
	const headTilt = {};
	const top = keypoints[10];
	const bottom = keypoints[2];
	const left = keypoints[454];
	const right = keypoints[234];
	if (!(top && bottom && left && right)) return null;
	headTilt.keypoints = { top, bottom, left, right };
	const pitchDy = bottom.y - top.y;
	const pitchDz = bottom.z - top.z;
	headTilt.pitch = Math.atan2(pitchDz, Math.abs(pitchDy));
	const yawDx = left.x - right.x;
	const yawDz = left.z - right.z;
	headTilt.yaw = Math.atan2(yawDz, Math.abs(yawDx));
	const rollDy = left.y - right.y;
	const rollDx = left.x - right.x;
	headTilt.roll = Math.atan2(rollDy, rollDx);
	return headTilt;
}

// Eyebrow (keyboard) hold accumulator, inline block
function stepEyebrow(state, { thresholdMet, allowed, now, gestureDt, eyebrowGestureDuration = 3000 }) {
	let { eyebrowGestureProgress, eyebrowGestureCooldownUntil } = state;
	let opened = false;
	if (thresholdMet && allowed && now >= eyebrowGestureCooldownUntil) {
		eyebrowGestureProgress += gestureDt / eyebrowGestureDuration;
		eyebrowGestureProgress = Math.min(eyebrowGestureProgress, 1);
	} else {
		eyebrowGestureProgress -= (gestureDt / eyebrowGestureDuration) * 1.5;
		eyebrowGestureProgress = Math.max(eyebrowGestureProgress, 0);
	}
	if (eyebrowGestureProgress >= 1) {
		eyebrowGestureProgress = 0;
		eyebrowGestureCooldownUntil = now + 3000;
		opened = true;
	}
	return { eyebrowGestureProgress, eyebrowGestureCooldownUntil, opened };
}

// Sleep (both eyes closed) accumulator, inline block
function stepSleep(sleepGestureProgress, { bothClosed, deltaTime, sleepGestureEyesClosedDuration = 2000 }) {
	let completed = false;
	if (bothClosed) {
		sleepGestureProgress += deltaTime / sleepGestureEyesClosedDuration;
		sleepGestureProgress = Math.min(sleepGestureProgress, 1);
	} else {
		sleepGestureProgress -= deltaTime / sleepGestureEyesClosedDuration;
		sleepGestureProgress = Math.max(sleepGestureProgress, 0);
	}
	if (sleepGestureProgress >= 1) {
		sleepGestureProgress = 0;
		completed = true;
	}
	return { sleepGestureProgress, completed };
}

// Mouth-open tilt scroll, inline block (returns direction; the original also called scrollMouse)
function mouthScroll(mouthInfo, headTilt, s) {
	let isMouthScrolling = false;
	let mouthScrollDirection = 0;
	if (mouthInfo.thresholdMet && headTilt) {
		const pitchDeg = (headTilt.pitch || 0) * 180 / Math.PI;
		const pitchOffsetDeg = (s.headTiltPitchOffset ? s.headTiltPitchOffset * 180 / Math.PI : 0);
		const relativePitch = pitchDeg - pitchOffsetDeg;
		if (relativePitch > 5) {
			isMouthScrolling = true;
			mouthScrollDirection = -1;
		} else if (relativePitch < -5) {
			isMouthScrolling = true;
			mouthScrollDirection = 1;
		}
	}
	return { isMouthScrolling, mouthScrollDirection };
}

// Click arbitration, inline block (mutates blinkInfo/mouthInfo exactly like the original)
function arbitrate({ s, blinkInfo, mouthInfo, prevMouthOpen, isMouthScrolling, mouseButtonUntilMouthCloses }) {
	blinkInfo.used = false;
	mouthInfo.used = false;
	let clickButton = -1;
	if (s.clickingMode === "blink") {
		blinkInfo.used = true;
		if (blinkInfo.leftEye.active) {
			clickButton = 0;
		} else if (blinkInfo.rightEye.active) {
			clickButton = 2;
		}
	}
	if (s.clickingMode === "open-mouth-ignoring-eyes") {
		mouthInfo.used = true;
		if (mouthInfo.thresholdMet) {
			clickButton = isMouthScrolling ? -1 : 0;
		}
	}
	if (s.clickingMode === "open-mouth" || s.clickingMode === "open-mouth-simple") {
		mouthInfo.used = true;
		blinkInfo.used = true;
		const allowModifiers = s.clickingMode !== "open-mouth-simple";
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
				mouthInfo.active = false;
			}
		}
		if (mouthInfo.thresholdMet || s.clickingMode === "open-mouth-simple") {
			blinkInfo.rightEye.active = clickButton === 1;
			blinkInfo.leftEye.active = clickButton === 2;
		}
	}
	return { clickButton, mouseButtonUntilMouthCloses };
}

// Cursor motion (acceleration, tilt influence, motion threshold, drag delay), inline block
function cursorDelta({ movementX, movementY, s, headTilt, mouseX, mouseY, screenWidth, screenHeight, timeSinceMouseDown }) {
	let accelerate = (delta, _distance) => (delta / 1) * (Math.abs(delta * 5) ** s.headTrackingAcceleration);
	let distance = Math.hypot(movementX, movementY);
	let deltaX = accelerate(movementX * s.headTrackingSensitivityX, distance);
	let deltaY = accelerate(movementY * s.headTrackingSensitivityY, distance);
	if (s.headTrackingTiltInfluence > 0) {
		const yawRange = [s.headTiltYawOffset - s.headTiltYawRange / 2, s.headTiltYawOffset + s.headTiltYawRange / 2];
		const pitchRange = [s.headTiltPitchOffset - s.headTiltPitchRange / 2, s.headTiltPitchOffset + s.headTiltPitchRange / 2];
		function normalize(value, min, max) {
			return (value - min) / (max - min);
		}
		const targetX = screenWidth * (1 - normalize(headTilt.yaw, yawRange[0], yawRange[1]));
		const targetY = screenHeight * normalize(headTilt.pitch, pitchRange[0], pitchRange[1]);
		const deltaXToMatchTilt = (mouseX - targetX) / screenWidth;
		const deltaYToMatchTilt = (targetY - mouseY) / screenHeight;
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
	if (Math.abs(deltaX * screenWidth) < s.headTrackingMinDistance) {
		deltaX = 0;
	}
	if (Math.abs(deltaY * screenHeight) < s.headTrackingMinDistance) {
		deltaY = 0;
	}
	if (timeSinceMouseDown < s.delayBeforeDragging) {
		deltaX = 0;
		deltaY = 0;
	}
	return { deltaX, deltaY };
}

module.exports = {
	signedDistancePointLine,
	getAspectMetrics,
	detectBlinks,
	detectMouthOpen,
	detectForeheadRaised,
	computeHeadTilt,
	stepEyebrow,
	stepSleep,
	mouthScroll,
	arbitrate,
	cursorDelta,
};
