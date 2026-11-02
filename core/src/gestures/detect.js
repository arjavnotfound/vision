// Facial gesture detectors with hysteresis (two thresholds: one to enter, one to leave).
// Extracted from vision.js without changing any math. Thresholds default to the original
// constants; calibration may pass per-profile values through settings.

import { getAspectMetrics, signedDistancePointLine } from "./geometry.js";

export const DEFAULT_THRESHOLDS = Object.freeze({
	// Eye aspect ratio (EAR): an open eye closes when EAR drops to `low` or below,
	// and a closed eye only counts as open again once EAR rises above `high`.
	eye: Object.freeze({ high: 0.2, low: 0.16 }),
	// Mouth aspect ratio (MAR): opens when MAR > high, stays open while MAR > low.
	mouth: Object.freeze({ high: 0.25, low: 0.15 }),
	// Eyebrow height / inter-ocular distance: raised when > high, stays raised while > low.
	brow: Object.freeze({ high: 0.28, low: 0.24 }),
});

/** Involuntary blink rejection: both eyes must be stable this long before a wink counts. */
export const BLINK_REJECT_DURATION_MS = 100;

/**
 * Wink/blink detection.
 * @param {object} annotations named facemesh contours (leftEyeUpper0, leftEyeLower0, rightEyeUpper0, rightEyeLower0)
 * @param {object|null|undefined} previous previous result (for hysteresis and timing)
 * @param {number} currentTime ms
 * @param {{high: number, low: number}} [thresholds]
 */
export function detectBlinks(annotations, previous, currentTime, thresholds = DEFAULT_THRESHOLDS.eye) {
	const eyes = {
		leftEye: getAspectMetrics(annotations.leftEyeUpper0, annotations.leftEyeLower0),
		rightEye: getAspectMetrics(annotations.rightEyeUpper0, annotations.rightEyeLower0)
	};

	const thresholdHigh = thresholds.high;
	const thresholdLow = thresholds.low;
	for (const key of ["leftEye", "rightEye"]) {
		eyes[key].open = eyes[key].heightRatio > (previous?.[key].open ? thresholdLow : thresholdHigh);
	}

	for (const key of ["leftEye", "rightEye"]) {
		if (eyes[key].open === previous?.[key].open) {
			eyes[key].timeSinceChange = previous?.[key].timeSinceChange ?? currentTime;
		} else {
			eyes[key].timeSinceChange = currentTime;
		}
	}
	const timeSinceChange = currentTime - Math.max(eyes.leftEye.timeSinceChange, eyes.rightEye.timeSinceChange);
	eyes.leftEye.active = timeSinceChange > BLINK_REJECT_DURATION_MS && eyes.rightEye.open && !eyes.leftEye.open;
	eyes.rightEye.active = timeSinceChange > BLINK_REJECT_DURATION_MS && eyes.leftEye.open && !eyes.rightEye.open;

	eyes.leftEye.thresholdMet = !eyes.leftEye.open;
	eyes.rightEye.thresholdMet = !eyes.rightEye.open;

	return eyes;
}

/**
 * Mouth-open detection (MAR with hysteresis).
 * @param {object} annotations (lipsUpperInner, lipsLowerInner)
 * @param {object|null|undefined} previous
 * @param {{high: number, low: number}} [thresholds]
 */
export function detectMouthOpen(annotations, previous, thresholds = DEFAULT_THRESHOLDS.mouth) {
	const prevThresholdMet = previous?.thresholdMet;
	const mouth = getAspectMetrics(annotations.lipsUpperInner, annotations.lipsLowerInner);
	mouth.thresholdMet = mouth.heightRatio > (prevThresholdMet ? thresholds.low : thresholds.high);
	mouth.active = mouth.thresholdMet;
	return mouth;
}

/**
 * Eyebrow/forehead raise detection: brow height relative to the eye line,
 * normalised by the distance between the eyes.
 * @param {object} annotations
 * @param {object|null|undefined} previous
 * @param {{high: number, low: number}} [thresholds]
 */
export function detectForeheadRaised(annotations, previous, thresholds = DEFAULT_THRESHOLDS.brow) {
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

	const prevThresholdMet = previous?.thresholdMet || false;
	// In human FaceMesh geometry: neutral eyebrow-to-eye axis is ~0.20-0.24, raised is >0.28-0.38
	const threshold = prevThresholdMet ? thresholds.low : thresholds.high;

	// Collective raise: both left and right must be elevated
	const isRaised = avgRatio > threshold && leftRatio > (threshold - 0.05) && rightRatio > (threshold - 0.05);

	return {
		leftRatio,
		rightRatio,
		avgRatio,
		thresholdMet: isRaised,
		active: isRaised
	};
}
