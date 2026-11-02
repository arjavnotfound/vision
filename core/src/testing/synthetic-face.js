// QA only: a synthetic face-mesh prediction with controllable eyes, mouth and brows.
// Lets the full pipeline (gestures -> clicks -> IPC -> mouse safety -> driver) be tested
// without a person in front of the camera. Never used in normal runs.

const FRAME = { width: 640, height: 480 };

const IDX = {
	silhouette: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
	lipsUpperInner: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308],
	lipsLowerInner: [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308],
	rightEyeUpper0: [246, 161, 160, 159, 158, 157, 173],
	rightEyeLower0: [33, 7, 163, 144, 145, 153, 154, 155, 133],
	leftEyeUpper0: [466, 388, 387, 386, 385, 384, 398],
	leftEyeLower0: [263, 249, 390, 373, 374, 380, 381, 382, 362],
	rightEyebrowUpper: [156, 70, 63, 105, 66, 107, 55, 193],
	leftEyebrowUpper: [383, 300, 293, 334, 296, 336, 285, 417],
};

/** Default scripted timeline (ms within a 20 s loop). Brow raise is < 3 s on purpose (no keyboard). */
export function scriptedPose(timeMs) {
	const t = timeMs % 20000;
	const between = (a, b) => t >= a && t < b;
	return {
		leftEye: between(3000, 3800) || between(11500, 12000) ? 0.05 : 0.3,
		rightEye: between(4800, 5600) || between(11500, 12000) ? 0.05 : 0.3,
		mouth: between(6600, 8000) ? 0.5 : 0.05,
		brow: between(9000, 10500) ? 0.34 : 0.22,
	};
}

/**
 * @param {{leftEye:number, rightEye:number, mouth:number, brow:number, pitch?:number}} pose
 *   eye/mouth: aspect ratio; brow: brow height / eye distance; pitch: degrees (up positive)
 */
export function syntheticPrediction(pose) {
	const keypoints = Array.from({ length: 478 }, () => ({ x: 320, y: 230, z: 0 }));
	const set = (index, x, y, z = 0) => {
		keypoints[index] = { x, y, z };
	};
	// Almond-shaped contour: corners at the ends of `lower`, `upper` without corners.
	const almond = (upperIdx, lowerIdx, cx, cy, width, ratio, flip) => {
		const opening = ratio * width;
		const n = lowerIdx.length;
		lowerIdx.forEach((index, i) => {
			const u = i / (n - 1);
			const x = cx + (flip ? -1 : 1) * (u - 0.5) * width;
			set(index, x, cy + Math.sin(u * Math.PI) * opening * 0.35);
		});
		upperIdx.forEach((index, i) => {
			const u = (i + 1) / (upperIdx.length + 1);
			const x = cx + (flip ? -1 : 1) * (u - 0.5) * width;
			set(index, x, cy - Math.sin(u * Math.PI) * opening * 0.65);
		});
	};
	// Subject's right eye is on the image left. Outer corners (33, 263) first, as in Face Mesh.
	almond(IDX.rightEyeUpper0, IDX.rightEyeLower0, 285, 200, 40, pose.rightEye, false);
	almond(IDX.leftEyeUpper0, IDX.leftEyeLower0, 355, 200, 40, pose.leftEye, true);
	// Lips: inner contours share their corner points (78, 308).
	const lipW = 56;
	const lipOpen = pose.mouth * lipW;
	IDX.lipsLowerInner.forEach((index, i) => {
		const u = i / (IDX.lipsLowerInner.length - 1);
		set(index, 320 + (u - 0.5) * lipW, 300 + Math.sin(u * Math.PI) * lipOpen * 0.5);
	});
	IDX.lipsUpperInner.forEach((index, i) => {
		const u = i / (IDX.lipsUpperInner.length - 1);
		if (i === 0 || i === IDX.lipsUpperInner.length - 1) return; // shared corners
		set(index, 320 + (u - 0.5) * lipW, 300 - Math.sin(u * Math.PI) * lipOpen * 0.5);
	});
	// Brows: height above the eye line, relative to the outer-corner distance.
	const eyeDistance = Math.abs(keypoints[263].x - keypoints[33].x);
	const browY = 200 - pose.brow * eyeDistance;
	IDX.rightEyebrowUpper.forEach((index, i) => set(index, 262 + i * 7, browY));
	IDX.leftEyebrowUpper.forEach((index, i) => set(index, 330 + i * 7, browY));
	// Silhouette
	IDX.silhouette.forEach((index, i) => {
		const a = (i / IDX.silhouette.length) * Math.PI * 2 - Math.PI / 2;
		set(index, 320 + Math.cos(a) * 92, 230 + Math.sin(a) * 124);
	});
	// Nose, cheeks, pose landmarks (level head: z = 0)
	set(1, 320, 245);
	set(2, 320, 255);
	set(98, 305, 252);
	set(327, 335, 252);
	set(168, 320, 198);
	set(205, 270, 260);
	set(425, 370, 260);
	// Pitch (degrees, up positive): depth difference between forehead (10) and nose bottom (2).
	const pitchDz = Math.tan(((pose.pitch ?? 0) * Math.PI) / 180) * 145;
	set(10, 320, 110, 0);
	keypoints[2].z = pitchDz;
	set(454, 410, 220);
	set(234, 230, 220);
	return { keypoints, box: { xMin: 228, yMin: 106, width: 184, height: 248 } };
}

/**
 * Returns an estimateFaces-like function. Uses `globalThis.__syntheticFaceOverride`
 * (set by the QA script) when present, otherwise the scripted timeline.
 */
export function createSyntheticFace({ start = performance.now() } = {}) {
	return () => {
		const override = globalThis.__syntheticFaceOverride;
		if (override === "none") {
			return [];
		}
		const pose = override && typeof override === "object" ? { ...scriptedPose(0), ...override } : scriptedPose(performance.now() - start);
		return [syntheticPrediction(pose)];
	};
}

export { FRAME as SYNTHETIC_FRAME };
