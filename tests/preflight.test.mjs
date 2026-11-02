import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { preflightReport } from "../app/src/ui/js/preflight.js";

const allGood = { camera: true, mic: true, internet: true, keys: true, build: "ok" };

describe("Start screen preflight", () => {
	it("all green, nothing to say", () => {
		const r = preflightReport({ preflight: allGood, cameraStatus: "on", micOk: true, internet: true, assistantSeen: true });
		assert.deepEqual(r.dots, { camera: true, mic: true, internet: true, assistant: true });
		assert.equal(r.line, null);
	});

	it("no internet: voice off, face control still works", () => {
		const r = preflightReport({ preflight: { ...allGood, internet: false }, cameraStatus: "on", micOk: true, internet: false, assistantSeen: true });
		assert.equal(r.dots.internet, false);
		assert.equal(r.dots.assistant, false);
		assert.equal(r.dots.camera, true);
		assert.equal(r.line, "No internet. Voice is off, face control still works.");
	});

	it("live internet check overrides the launcher's snapshot", () => {
		const r = preflightReport({ preflight: { ...allGood, internet: false }, cameraStatus: "on", micOk: true, internet: true, assistantSeen: true });
		assert.equal(r.line, null);
	});

	it("missing keys, missing mic, missing camera, building", () => {
		assert.match(preflightReport({ preflight: { ...allGood, keys: false }, cameraStatus: "on", micOk: true, internet: true }).line, /keys are missing/);
		assert.match(preflightReport({ preflight: allGood, cameraStatus: "on", micOk: false, internet: true }).line, /No microphone/);
		const noCam = preflightReport({ preflight: { ...allGood, camera: false }, cameraStatus: "starting", micOk: true, internet: true, assistantSeen: true });
		assert.equal(noCam.dots.camera, false);
		assert.match(noCam.line, /No camera found/);
		assert.match(preflightReport({ preflight: { ...allGood, build: "building" }, cameraStatus: "on", micOk: true, internet: true }).line, /Preparing the voice assistant/);
	});

	it("without the launcher (no preflight) dots wait for live checks", () => {
		const r = preflightReport({ preflight: null, cameraStatus: "starting", micOk: null, internet: null, assistantSeen: false });
		assert.deepEqual(r.dots, { camera: null, mic: null, internet: null, assistant: null });
		assert.equal(r.line, null);
	});
});
