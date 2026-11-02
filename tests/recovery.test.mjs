import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRecoveryMonitor, FACE_PROMPT_MS, CAMERA_RETRY_MS, CAMERA_STUCK_MS } from "../app/src/ui/js/recovery.js";

const tracking = { status: "tracking", paused: false, camera: { status: "on" } };
const noFace = { status: "no-face", paused: false, camera: { status: "on" } };
const camError = { status: "camera-error", paused: false, camera: { status: "error" } };
const types = (actions) => actions.map((a) => a.type);

describe("recovery", () => {
	it("face lost: releases buttons, says 'Look at the camera' once, resumes on its own", () => {
		const r = createRecoveryMonitor();
		assert.deepEqual(r.step(tracking, 0), []);
		assert.deepEqual(r.step(noFace, 100), []);
		assert.deepEqual(types(r.step(noFace, 450)), ["release"]);
		assert.deepEqual(r.step(noFace, 1000), []);
		const prompt = r.step(noFace, 100 + FACE_PROMPT_MS);
		assert.deepEqual(prompt, [{ type: "speak", text: "Look at the camera." }]);
		assert.deepEqual(r.step(noFace, 9000), [], "only once per loss");
		assert.deepEqual(r.step(tracking, 9100), [], "face back: nothing to restart");
		assert.deepEqual(types(r.step(noFace, 9200)), []);
		assert.deepEqual(types(r.step(noFace, 9600)), ["release"], "a new loss is handled again");
	});

	it("a paused tracker never nags", () => {
		const r = createRecoveryMonitor();
		assert.deepEqual(r.step({ ...noFace, paused: true }, 0), []);
		assert.deepEqual(r.step({ ...noFace, paused: true }, 5000), []);
	});

	it("camera unplugged or busy: clear message and automatic retries until it works", () => {
		const r = createRecoveryMonitor();
		const first = r.step(camError, 0);
		assert.deepEqual(types(first), ["banner", "retryCamera"]);
		assert.match(first[0].text, /Camera unplugged or busy/);
		assert.deepEqual(r.step(camError, 1000), []);
		assert.deepEqual(types(r.step(camError, CAMERA_RETRY_MS)), ["retryCamera"]);
		assert.deepEqual(r.step(tracking, CAMERA_RETRY_MS + 100), [{ type: "banner", text: null }]);
	});

	it("an ended track or a camera stuck starting counts as lost", () => {
		const r = createRecoveryMonitor();
		assert.deepEqual(types(r.step(tracking, 0, { trackEnded: true })), ["banner", "retryCamera"]);
		const s = createRecoveryMonitor();
		const starting = { status: "starting", paused: false, camera: { status: "starting" } };
		assert.deepEqual(s.step(starting, 0), []);
		assert.deepEqual(types(s.step(starting, CAMERA_STUCK_MS + 1)), ["banner", "retryCamera"]);
	});
});
