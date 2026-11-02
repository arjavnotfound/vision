// Small, pure helpers for the main process's input IPC handlers, kept separate so
// they can be unit tested without Electron.

/**
 * Creates the handler behind the `scrollMouse` IPC call (mouth-open + head tilt scroll).
 * Scrolling is a synthetic input, so it obeys the same gate as clicking.
 */
function createScrollHandler({
	isClickingAllowed,
	pressKey,
	now = () => performance.now(),
	throttleMs = 35,
	log = console.error,
}) {
	if (typeof isClickingAllowed !== 'function') {
		throw new TypeError('createScrollHandler: isClickingAllowed must be a function');
	}
	let lastScrollTime = -Infinity;
	return async function handleScroll(deltaY) {
		if (!isClickingAllowed()) {
			return false;
		}
		const time = now();
		if (time - lastScrollTime < throttleMs) {
			return false;
		}
		lastScrollTime = time;
		if (typeof pressKey !== 'function') {
			return false;
		}
		try {
			await pressKey(deltaY < 0 ? 'up' : 'down');
			return true;
		} catch (error) {
			log('Failed to scroll via pressKey:', error);
			return false;
		}
	};
}

/**
 * Coalesces overlay updates: at most one send per `minIntervalMs`, and only when the
 * payload actually changed. Replaces the old unconditional 100 Hz send.
 */
function createOverlaySync({
	send,
	minIntervalMs = 16,
	now = () => performance.now(),
	schedule = setTimeout,
	cancel = clearTimeout,
	serialize = JSON.stringify,
}) {
	let buildPayload = null;
	let lastKey = null;
	let lastSentAt = -Infinity;
	let timer = null;

	function flush() {
		timer = null;
		if (!buildPayload) {
			return false;
		}
		const payload = buildPayload();
		if (!payload) {
			return false;
		}
		const key = serialize(payload);
		if (key === lastKey) {
			return false;
		}
		const sent = send(payload);
		if (sent === false) {
			// Receiver not ready; try again on the next request.
			return false;
		}
		lastKey = key;
		lastSentAt = now();
		return true;
	}

	function request(build) {
		buildPayload = build;
		if (timer !== null) {
			return;
		}
		const wait = Math.max(0, lastSentAt + minIntervalMs - now());
		timer = schedule(flush, wait);
	}

	return {
		request,
		flush,
		/** Forget the last payload so the next flush always sends (e.g. after overlay reload). */
		invalidate() {
			lastKey = null;
		},
		dispose() {
			if (timer !== null) {
				cancel(timer);
				timer = null;
			}
		},
	};
}

/**
 * Reduces the renderer's input feedback (which includes full eye/lip contours) to the
 * fields the screen overlay actually draws. Keeps IPC payloads small and comparable.
 */
function summarizeInputFeedback(inputFeedback = {}) {
	const pick = (m) => m ? {
		heightRatio: Number.isFinite(m.heightRatio) ? Math.round(m.heightRatio * 1000) / 1000 : 0,
		active: Boolean(m.active),
		thresholdMet: Boolean(m.thresholdMet),
	} : null;
	const { blinkInfo, mouthInfo } = inputFeedback;
	return {
		headNotFound: Boolean(inputFeedback.headNotFound),
		blinkInfo: blinkInfo ? {
			used: Boolean(blinkInfo.used),
			leftEye: pick(blinkInfo.leftEye),
			rightEye: pick(blinkInfo.rightEye),
		} : null,
		mouthInfo: mouthInfo ? { used: Boolean(mouthInfo.used), ...pick(mouthInfo) } : null,
		eyebrowGestureProgress: Math.round((inputFeedback.eyebrowGestureProgress || 0) * 100) / 100,
	};
}

module.exports = {
	createScrollHandler,
	createOverlaySync,
	summarizeInputFeedback,
};
