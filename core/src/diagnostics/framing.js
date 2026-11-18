// Lighting and framing checks (AUDIT P1-6): turns cheap image/face measurements into
// one plain-language hint for the user. Purely advisory; never affects tracking.

export const FRAMING_LIMITS = Object.freeze({
	minBrightness: 55, // mean luma 0..255 below this: too dark for reliable landmarks
	maxBrightness: 225, // above this: washed out
	minFaceSize: 0.2, // face width / frame width
	maxFaceSize: 0.62,
	maxOffsetX: 0.28, // face centre offset from frame centre, as a fraction of half the frame
	maxOffsetY: 0.36,
});

/**
 * Mean luma of an RGBA ImageData-like object, sampling every `stride`-th pixel.
 * With `box` (frame pixels), only pixels inside it count: the light on the face.
 * @param {{data: Uint8ClampedArray|number[], width: number, height: number}} imageData
 * @param {number} [stride]
 * @param {{x:number,y:number,width:number,height:number}|null} [box]
 */
export function measureBrightness(imageData, stride = 16, box = null) {
	const { data, width, height } = imageData;
	if (!data || !data.length) {
		return 0;
	}
	let sum = 0;
	let count = 0;
	// Rec. 601 luma, integer approximation
	const luma = (i) => (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
	if (box && width > 0 && height > 0) {
		const x0 = Math.max(0, Math.floor(box.x)), x1 = Math.min(width, Math.ceil(box.x + box.width));
		const y0 = Math.max(0, Math.floor(box.y)), y1 = Math.min(height, Math.ceil(box.y + box.height));
		const step = Math.max(1, Math.round(Math.sqrt(stride)));
		for (let y = y0; y < y1; y += step) {
			for (let x = x0; x < x1; x += step) {
				sum += luma((y * width + x) * 4);
				count++;
			}
		}
		if (count) return sum / count;
	}
	const step = Math.max(1, stride) * 4;
	for (let i = 0; i + 2 < data.length; i += step) {
		sum += luma(i);
		count++;
	}
	return count ? sum / count : 0;
}

/**
 * Low light: the face has been darker than `threshold` for `holdMs`.
 * `step` returns true exactly once per session (the one "More light" notice);
 * `low` is the current debounced state (for the overlay and Diagnostics).
 */
export function createLowLightWatch({ threshold = FRAMING_LIMITS.minBrightness, holdMs = 3000 } = {}) {
	let darkSince = null;
	let told = false;
	const watch = {
		low: false,
		step(brightness, now) {
			if (!Number.isFinite(brightness) || brightness >= threshold) {
				darkSince = null;
				watch.low = false;
				return false;
			}
			darkSince ??= now;
			watch.low = now - darkSince >= holdMs;
			if (watch.low && !told) {
				told = true;
				return true;
			}
			return false;
		},
	};
	return watch;
}

/** Below this tracking confidence the cursor holds its last good position. */
export const CONFIDENCE_FLOOR = 0.2;
// shortcut: confidence is the optical-flow point count (face mesh reports a fixed 0.9999);
// upgrade if the landmark model ever gives a real score.
const CONFIDENT_POINTS = 60;

/** 0..1: how much the cursor can trust this frame's movement. */
export function trackingConfidence({ faceFound, points }) {
	if (!faceFound) return 0;
	return Math.min(1, Math.max(0, points || 0) / CONFIDENT_POINTS);
}

/**
 * @param {object} input
 * @param {boolean} input.faceFound
 * @param {number} input.brightness mean luma 0..255
 * @param {{x:number,y:number,width:number,height:number}|null} input.faceBox in frame pixels
 * @param {number} input.frameWidth
 * @param {number} input.frameHeight
 * @returns {{ok: boolean, hint: string, code: string, faceSize: number, offsetX: number, offsetY: number, brightness: number}}
 */
export function assessFraming({ faceFound, brightness, faceBox, frameWidth, frameHeight }, limits = FRAMING_LIMITS) {
	let faceSize = 0;
	let offsetX = 0;
	let offsetY = 0;
	if (faceBox && frameWidth > 0 && frameHeight > 0) {
		faceSize = faceBox.width / frameWidth;
		offsetX = ((faceBox.x + faceBox.width / 2) - frameWidth / 2) / (frameWidth / 2);
		offsetY = ((faceBox.y + faceBox.height / 2) - frameHeight / 2) / (frameHeight / 2);
	}
	const result = (code, hint, ok = false) => ({ ok, code, hint, faceSize, offsetX, offsetY, brightness });

	if (Number.isFinite(brightness) && brightness < limits.minBrightness) {
		return result("dark", "MORE LIGHT");
	}
	if (!faceFound || !faceBox) {
		return result("no-face", "LOOK AT THE CAMERA");
	}
	if (brightness > limits.maxBrightness) {
		return result("bright", "LESS BACKLIGHT");
	}
	if (faceSize < limits.minFaceSize) {
		return result("far", "MOVE CLOSER");
	}
	if (faceSize > limits.maxFaceSize) {
		return result("near", "MOVE BACK");
	}
	if (Math.abs(offsetX) > limits.maxOffsetX || Math.abs(offsetY) > limits.maxOffsetY) {
		return result("off-center", "CENTER YOUR FACE");
	}
	return result("ok", "FRAMED", true);
}
