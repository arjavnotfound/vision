// Picks which detected face to follow, and keeps following it.
//
// Before: `facemeshPrediction = predictions[0]`, so a second person entering the frame
// (common at an expo) could steal the cursor. Now:
//   - With no lock: pick the largest face, nudged toward the most central one.
//   - With a lock: pick the face nearest the locked one. A face that suddenly appears
//     far away is ignored while the locked face is only briefly missing.
//   - The lock is released after the locked face has been gone for `lostAfterMs`.

/** Bounding box of a face-landmarks-detection prediction, in pixels. */
export function faceBox(prediction) {
	const box = prediction?.box;
	if (box && Number.isFinite(box.xMin) && Number.isFinite(box.width)) {
		return { x: box.xMin, y: box.yMin, width: box.width, height: box.height };
	}
	const keypoints = prediction?.keypoints;
	if (!keypoints || !keypoints.length) {
		return null;
	}
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const point of keypoints) {
		if (point.x < minX) minX = point.x;
		if (point.y < minY) minY = point.y;
		if (point.x > maxX) maxX = point.x;
		if (point.y > maxY) maxY = point.y;
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const center = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/**
 * @param {object} options
 * @param {() => {width: number, height: number}} options.getFrameSize
 * @param {number} [options.maxJumpFraction] max movement of the locked face between estimates, as a fraction of the frame diagonal
 * @param {number} [options.lostAfterMs] how long the locked face may be missing before any face can be picked
 */
export function createFaceLock({ getFrameSize, maxJumpFraction = 0.25, lostAfterMs = 1000 } = {}) {
	let lock = null; // { cx, cy, size, lastSeen }

	function score(box, frame) {
		const size = Math.sqrt(box.width * box.height) / frame.width;
		const c = center(box);
		const offset = Math.hypot(c.x - frame.width / 2, c.y - frame.height / 2) / Math.hypot(frame.width, frame.height);
		return size - 0.5 * offset;
	}

	return {
		/**
		 * @param {Array} predictions
		 * @param {number} time ms
		 * @returns {object|undefined} the prediction to use, or undefined for "no face"
		 */
		select(predictions, time) {
			const frame = getFrameSize();
			const diag = Math.hypot(frame.width, frame.height) || 1;
			const candidates = (predictions || [])
				.map((prediction) => ({ prediction, box: faceBox(prediction) }))
				.filter((c) => c.box && c.box.width > 0 && c.box.height > 0);

			if (lock && time - lock.lastSeen > lostAfterMs) {
				lock = null;
			}

			let chosen = null;
			if (lock) {
				let best = null;
				let bestDistance = Infinity;
				for (const candidate of candidates) {
					const c = center(candidate.box);
					const distance = Math.hypot(c.x - lock.cx, c.y - lock.cy);
					if (distance < bestDistance) {
						bestDistance = distance;
						best = candidate;
					}
				}
				if (best && bestDistance <= maxJumpFraction * diag) {
					chosen = best;
				} else {
					// Locked face momentarily missing: don't jump to someone else yet.
					return undefined;
				}
			} else {
				let bestScore = -Infinity;
				for (const candidate of candidates) {
					const s = score(candidate.box, frame);
					if (s > bestScore) {
						bestScore = s;
						chosen = candidate;
					}
				}
			}

			if (!chosen) {
				return undefined;
			}
			const c = center(chosen.box);
			lock = { cx: c.x, cy: c.y, size: Math.sqrt(chosen.box.width * chosen.box.height), lastSeen: time };
			return chosen.prediction;
		},
		reset() {
			lock = null;
		},
		get locked() {
			return lock ? { ...lock } : null;
		},
	};
}
