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
 * @param {{data: Uint8ClampedArray|number[], width: number, height: number}} imageData
 */
export function measureBrightness(imageData, stride = 16) {
	const { data } = imageData;
	if (!data || !data.length) {
		return 0;
	}
	let sum = 0;
	let count = 0;
	const step = Math.max(1, stride) * 4;
	for (let i = 0; i + 2 < data.length; i += step) {
		// Rec. 601 luma, integer approximation
		sum += (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
		count++;
	}
	return count ? sum / count : 0;
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
