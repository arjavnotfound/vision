// Recovery without a restart (pure state machine, unit tested; main.js runs the actions).
//
//   Face lost:    after FACE_RELEASE_MS any held mouse button is released (the engine
//                 already stops moving the cursor without a face); after FACE_PROMPT_MS
//                 VISION says "Look at the camera" once. When the face comes back,
//                 tracking simply continues: nothing to restart.
//   Camera lost:  unplugged, busy (another app), blocked or stuck starting -> a banner
//                 naming the cause, spoken once after CAMERA_SPEAK_MS, and the camera is
//                 retried every CAMERA_RETRY_MS until it works. No click is ever needed.

export const FACE_RELEASE_MS = 300;
export const FACE_PROMPT_MS = 2000;
export const CAMERA_RETRY_MS = 5000;
export const CAMERA_STUCK_MS = 10000;
export const CAMERA_SPEAK_MS = 3000;

// Plain words for each getUserMedia failure (DOMException names).
export function cameraProblem(error) {
	switch (error?.name) {
		case "NotReadableError":
		case "TrackStartError":
		case "AbortError":
			return "Another app is using the camera. Close it, and VISION will start again by itself.";
		case "NotAllowedError":
		case "SecurityError":
		case "PermissionDeniedError":
			return "Camera access is turned off in Windows settings. Ask a helper to turn on camera access for desktop apps. VISION keeps trying.";
		case "NotFoundError":
		case "DevicesNotFoundError":
		case "OverconstrainedError":
			return "No camera found. Plug the camera in, and VISION will start again by itself.";
		default:
			return "The camera stopped working. VISION keeps trying.";
	}
}

export function createRecoveryMonitor() {
	let noFaceSince = null;
	let released = false;
	let prompted = false;
	let cameraBadSince = null;
	let lastRetry = -Infinity;
	let banner = null;
	let spokenCamera = null;

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
				const text = cameraProblem(state?.camera?.error);
				if (banner !== text) {
					banner = text;
					actions.push({ type: "banner", text });
				}
				// Spoken once per problem, after it has lasted CAMERA_SPEAK_MS (a quick retry stays silent).
				if (spokenCamera !== text && now - cameraBadSince >= CAMERA_SPEAK_MS) {
					spokenCamera = text;
					actions.push({ type: "speak", text, camera: true });
				}
				if (now - lastRetry >= CAMERA_RETRY_MS) {
					lastRetry = now;
					actions.push({ type: "retryCamera" });
				}
			}
		} else {
			cameraBadSince = null;
			if (spokenCamera) {
				spokenCamera = null;
				actions.push({ type: "speak", text: "The camera is working again.", camera: true });
			}
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
