// Recovery without a restart (pure state machine, unit tested; main.js runs the actions).
//
//   Face lost:    after FACE_RELEASE_MS any held mouse button is released (the engine
//                 already stops moving the cursor without a face); after FACE_PROMPT_MS
//                 VISION says "Look at the camera" once. When the face comes back,
//                 tracking simply continues: nothing to restart.
//   Camera lost:  unplugged, busy (another app) or stuck starting -> a clear banner, and
//                 the camera is retried every CAMERA_RETRY_MS until it works.

export const FACE_RELEASE_MS = 300;
export const FACE_PROMPT_MS = 2000;
export const CAMERA_RETRY_MS = 5000;
export const CAMERA_STUCK_MS = 10000;

export function createRecoveryMonitor() {
	let noFaceSince = null;
	let released = false;
	let prompted = false;
	let cameraBadSince = null;
	let lastRetry = -Infinity;
	let banner = null;

	/**
	 * @param {object} state engine.getState() (status, paused, camera)
	 * @param {number} now ms
	 * @param {object} [extra] { trackEnded: boolean }
	 * @returns {Array<{type: "release"|"speak"|"retryCamera"|"banner", text?: string|null}>}
	 */
	function step(state, now, extra = {}) {
		const actions = [];
		const camera = state?.camera?.status;
		const cameraBad = camera === "error" || Boolean(extra.trackEnded) || (state?.status === "starting" && camera !== "on");
		if (cameraBad) {
			cameraBadSince ??= now;
			const stuck = camera === "error" || extra.trackEnded || now - cameraBadSince > CAMERA_STUCK_MS;
			if (stuck) {
				const text = "Camera unplugged or busy. Close other apps using it, or plug it back in. Retrying…";
				if (banner !== text) {
					banner = text;
					actions.push({ type: "banner", text });
				}
				if (now - lastRetry >= CAMERA_RETRY_MS) {
					lastRetry = now;
					actions.push({ type: "retryCamera" });
				}
			}
		} else {
			cameraBadSince = null;
			if (banner) {
				banner = null;
				actions.push({ type: "banner", text: null });
			}
		}

		const faceLost = state?.status === "no-face" && !state?.paused;
		if (faceLost) {
			noFaceSince ??= now;
			if (!released && now - noFaceSince >= FACE_RELEASE_MS) {
				released = true;
				actions.push({ type: "release" });
			}
			if (!prompted && now - noFaceSince >= FACE_PROMPT_MS) {
				prompted = true;
				actions.push({ type: "speak", text: "Look at the camera." });
			}
		} else if (state?.status === "tracking" || state?.paused) {
			noFaceSince = null;
			released = false;
			prompted = false;
		}
		return actions;
	}

	return { step };
}
