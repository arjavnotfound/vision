// Serialised camera acquisition.
//
// Fixes the race where overlapping useCamera() calls each ran getUserMedia at once,
// leaking streams and locking the webcam ("NotReadableError: already in use").
//   - Requests run one at a time, in order.
//   - Only the newest request matters: queued older requests are skipped, and a stream
//     that arrives after a newer request was made is stopped immediately.
//   - The current stream is released BEFORE asking for a new one (Windows cameras are
//     usually exclusive, so asking first fails).
//   - "Camera busy" errors get a short automatic retry, because Windows often needs a
//     moment to free a camera that was just released.

export const BUSY_ERROR_NAMES = ["NotReadableError", "TrackStartError", "AbortError"];

export function isCameraBusyError(error) {
	return Boolean(error) && BUSY_ERROR_NAMES.includes(error.name);
}

export function stopStreamTracks(stream) {
	if (!stream || typeof stream.getTracks !== "function") {
		return;
	}
	for (const track of stream.getTracks()) {
		try {
			track.stop();
		} catch (_error) {
			// ignore
		}
	}
}

/**
 * @param {object} options
 * @param {(constraints: MediaStreamConstraints) => Promise<MediaStream>} options.getUserMedia
 * @param {() => void} [options.releaseCurrent] stop the stream currently in use
 * @param {number[]} [options.busyRetryDelaysMs]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createCameraAcquirer({
	getUserMedia,
	releaseCurrent = () => { },
	busyRetryDelaysMs = [600],
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
	let generation = 0;
	let chain = Promise.resolve();
	let inFlight = 0;

	/**
	 * @param {MediaStreamConstraints} constraints
	 * @param {{ releaseFirst?: boolean }} [options]
	 * @returns {Promise<{status: "ok", stream: MediaStream} | {status: "error", error: any} | {status: "superseded"}>}
	 */
	function acquire(constraints, { releaseFirst = true } = {}) {
		const myGeneration = ++generation;
		inFlight++;
		const run = async () => {
			if (myGeneration !== generation) {
				return { status: "superseded" };
			}
			if (releaseFirst) {
				releaseCurrent();
			}
			let attempt = 0;
			for (; ;) {
				try {
					const stream = await getUserMedia(constraints);
					if (myGeneration !== generation) {
						stopStreamTracks(stream);
						return { status: "superseded" };
					}
					return { status: "ok", stream };
				} catch (error) {
					if (myGeneration !== generation) {
						return { status: "superseded" };
					}
					if (isCameraBusyError(error) && attempt < busyRetryDelaysMs.length) {
						await sleep(busyRetryDelaysMs[attempt]);
						attempt++;
						if (myGeneration !== generation) {
							return { status: "superseded" };
						}
						continue;
					}
					return { status: "error", error };
				}
			}
		};
		const result = chain.then(run, run).finally(() => {
			inFlight--;
		});
		chain = result.catch(() => { });
		return result;
	}

	return {
		acquire,
		get busy() {
			return inFlight > 0;
		},
		/** Makes any pending request obsolete (e.g. on dispose). */
		cancelAll() {
			generation++;
		},
	};
}
