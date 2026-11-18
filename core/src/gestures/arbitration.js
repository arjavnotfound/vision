// Maps detected gestures to mouse actions. Several click methods can be on at once
// (settings clickWink, clickBlink, clickMouth, clickDwell); the eye arbiter makes sure
// one eye closure counts as exactly one thing: a wink, a deliberate blink, a quick blink
// (towards the three-blink pause), or nothing.

export const SCROLL_PITCH_THRESHOLD_DEG = 5;

// Both eyes shut at most this long: a quick blink. Natural blinks are 100-300 ms.
export const QUICK_BLINK_MAX_MS = 350;
// A deliberate blink click: both eyes shut at least this long, and reopened before the
// upper limit (longer belongs to "close your eyes for 2 seconds").
export const BLINK_CLICK_MIN_MS = 450;
export const BLINK_CLICK_MAX_MS = 1500;
// How long a blink click holds the button down.
export const BLINK_CLICK_PRESS_MS = 120;
// Three quick blinks inside this window pause or resume face control.
export const TRIPLE_BLINK_WINDOW_MS = 1500;
export const TRIPLE_BLINK_COUNT = 3;

/** The click methods that are on. Defaults: wink on, the rest off. */
export function clickMethods(s = {}) {
	return {
		wink: s.clickWink !== false,
		blink: s.clickBlink === true,
		mouth: s.clickMouth === true,
		dwell: s.clickDwell === true,
	};
}

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
 * Turns the per-frame eye state (from detectBlinks) into wink, blink-click and
 * three-blink events. Rules:
 *   - a wink only counts while the other eye has stayed open since both were last open,
 *     so the uneven end of a blink is never a wink;
 *   - a closure during which a wink happened is never a blink;
 *   - a blink is classified by how long both eyes stayed shut.
 */
export function createEyeArbiter() {
	let closedSince = null;
	let winkSeen = false;
	let bothSeen = false;
	let quickBlinks = [];
	let pressUntil = -Infinity;
	return {
		/**
		 * @param {{leftEye: {open: boolean, active: boolean}, rightEye: {open: boolean, active: boolean}}} eyes
		 * @param {number} now ms
		 * @returns {{wink: -1|0|2, blinkClick: boolean, tripleBlink: boolean}}
		 */
		step(eyes, now) {
			const leftOpen = Boolean(eyes.leftEye.open);
			const rightOpen = Boolean(eyes.rightEye.open);
			let tripleBlink = false;
			if (!leftOpen && !rightOpen) {
				closedSince ??= now;
				bothSeen = true;
			} else if (closedSince !== null) {
				const shut = now - closedSince;
				closedSince = null;
				if (!winkSeen) {
					if (shut <= QUICK_BLINK_MAX_MS) {
						quickBlinks = quickBlinks.filter((t) => now - t <= TRIPLE_BLINK_WINDOW_MS);
						quickBlinks.push(now);
						if (quickBlinks.length >= TRIPLE_BLINK_COUNT) {
							quickBlinks = [];
							tripleBlink = true;
						}
					} else if (shut >= BLINK_CLICK_MIN_MS && shut <= BLINK_CLICK_MAX_MS) {
						pressUntil = now + BLINK_CLICK_PRESS_MS;
					}
				}
			}
			let wink = -1;
			if (!bothSeen) {
				wink = eyes.leftEye.active ? 0 : eyes.rightEye.active ? 2 : -1;
			}
			if (wink !== -1) {
				winkSeen = true;
				quickBlinks = [];
			}
			if (leftOpen && rightOpen) {
				winkSeen = false;
				bothSeen = false;
			}
			return { wink, blinkClick: now < pressUntil, tripleBlink };
		},
		reset() {
			closedSince = null;
			winkSeen = false;
			bothSeen = false;
			quickBlinks = [];
			pressUntil = -Infinity;
		},
	};
}

/**
 * Which mouse button the face is holding down this frame. A wink wins over the mouth,
 * the mouth over a blink click.
 * @returns {-1|0|2} -1 none, 0 left, 2 right
 */
export function chooseClickButton({ methods, wink = -1, blinkClick = false, mouthOpen = false, isMouthScrolling = false }) {
	if (methods.wink && wink !== -1) return wink;
	if (methods.mouth && mouthOpen && !isMouthScrolling) return 0;
	if (methods.blink && blinkClick) return 0;
	return -1;
}
