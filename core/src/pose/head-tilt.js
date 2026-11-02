// Head pose (pitch / yaw / roll) from face-mesh keypoints, plus One Euro smoothing.
// Extracted from vision.js without changing the math.

import { OneEuroFilter } from "../filters/one-euro.js";

export const POSE_KEYPOINTS = Object.freeze({ top: 10, bottom: 2, left: 454, right: 234 });

// Smoothing parameters used since the original implementation. Do not change casually.
export const HEAD_TILT_FILTER = Object.freeze({ freq: 60, mincutoff: 0.01, beta: 5.0, dcutoff: 0.7 });

/**
 * Raw head tilt in radians.
 * - pitch: forehead (10) vs. bottom of nose (2), using depth (z)
 * - yaw: subject's left cheek (454) vs. right cheek (234), using depth
 * - roll: in-image angle of the cheek-to-cheek line
 * @param {Array<{x:number,y:number,z:number}>} keypoints
 * @returns {{pitch:number, yaw:number, roll:number, keypoints:object} | null}
 */
export function computeHeadTilt(keypoints) {
	if (!keypoints) {
		return null;
	}
	const top = keypoints[POSE_KEYPOINTS.top]; // Top of forehead
	const bottom = keypoints[POSE_KEYPOINTS.bottom]; // Bottom of nose (formerly chin; this better avoids jaw movement effects)
	const left = keypoints[POSE_KEYPOINTS.left]; // Subject left (Image right)
	const right = keypoints[POSE_KEYPOINTS.right]; // Subject right (Image left)
	if (!(top && bottom && left && right)) {
		return null;
	}

	// Pitch (X-axis rotation)
	const pitchDy = bottom.y - top.y;
	const pitchDz = bottom.z - top.z;
	const pitch = Math.atan2(pitchDz, Math.abs(pitchDy));

	// Yaw (Y-axis rotation)
	const yawDx = left.x - right.x;
	const yawDz = left.z - right.z;
	const yaw = Math.atan2(yawDz, Math.abs(yawDx));

	// Roll (Z-axis rotation)
	const rollDy = left.y - right.y;
	const rollDx = left.x - right.x;
	const roll = Math.atan2(rollDy, rollDx);

	return { pitch, yaw, roll, keypoints: { top, bottom, left, right } };
}

/** One Euro filters for pitch, yaw and roll (created on first use, like before). */
export function createHeadTiltSmoother(params = HEAD_TILT_FILTER) {
	let filters = null;
	return {
		/**
		 * @param {{pitch:number, yaw:number, roll:number}} tilt raw radians
		 * @param {number} timestampSeconds
		 * @returns {{pitch:number, yaw:number, roll:number}}
		 */
		filter(tilt, timestampSeconds) {
			if (!filters) {
				filters = {};
				for (const axis of ["pitch", "yaw", "roll"]) {
					filters[axis] = new OneEuroFilter(params.freq, params.mincutoff, params.beta, params.dcutoff);
				}
			}
			return {
				pitch: filters.pitch.filter(tilt.pitch, timestampSeconds),
				yaw: filters.yaw.filter(tilt.yaw, timestampSeconds),
				roll: filters.roll.filter(tilt.roll, timestampSeconds),
			};
		},
		reset() {
			filters = null;
		},
	};
}

export const radToDeg = (radians) => radians * 180 / Math.PI;
export const degToRad = (degrees) => degrees * Math.PI / 180;
