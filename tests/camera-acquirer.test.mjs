import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCameraAcquirer, isCameraBusyError } from "../core/src/camera/acquirer.js";

function fakeStream(id, log) {
	return {
		id,
		getTracks: () => [{ stop: () => log.push(`stop:${id}`) }],
	};
}

function deferred() {
	let resolve, reject;
	const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

const namedError = (name) => Object.assign(new Error(name), { name });

describe("Camera acquisition (AUDIT 2.1 race)", () => {
	it("runs getUserMedia calls one at a time and releases the old stream before asking", async () => {
		const log = [];
		let active = 0;
		let maxActive = 0;
		let n = 0;
		const acquirer = createCameraAcquirer({
			getUserMedia: async () => {
				active++;
				maxActive = Math.max(maxActive, active);
				log.push(`gum:${++n}`);
				await new Promise((r) => setTimeout(r, 5));
				active--;
				return fakeStream(n, log);
			},
			releaseCurrent: () => log.push("release"),
		});
		const a = await acquirer.acquire({});
		const b = await acquirer.acquire({});
		assert.equal(a.status, "ok");
		assert.equal(b.status, "ok");
		assert.equal(maxActive, 1);
		assert.deepEqual(log, ["release", "gum:1", "release", "gum:2"]);
	});

	it("overlapping requests: only the newest wins; stale streams are stopped immediately", async () => {
		const log = [];
		const pending = [];
		const acquirer = createCameraAcquirer({
			getUserMedia: () => {
				const d = deferred();
				pending.push(d);
				return d.promise;
			},
			releaseCurrent: () => log.push("release"),
		});
		const first = acquirer.acquire({ video: { deviceId: "a" } });
		await new Promise((r) => setTimeout(r, 0));
		// The first request is in flight...
		assert.equal(pending.length, 1);
		// ...when the user picks two other cameras in quick succession.
		const second = acquirer.acquire({ video: { deviceId: "b" } });
		const third = acquirer.acquire({ video: { deviceId: "c" } });
		await new Promise((r) => setTimeout(r, 0));
		assert.equal(pending.length, 1, "no parallel getUserMedia");
		pending[0].resolve(fakeStream("a", log));
		assert.deepEqual(await first, { status: "superseded" });
		assert.ok(log.includes("stop:a"), "stale stream must be stopped");
		await new Promise((r) => setTimeout(r, 0));
		// The second request was skipped entirely; the third one runs.
		assert.equal(pending.length, 2);
		pending[1].resolve(fakeStream("c", log));
		assert.deepEqual(await second, { status: "superseded" });
		const result = await third;
		assert.equal(result.status, "ok");
		assert.equal(result.stream.id, "c");
		assert.ok(!log.includes("stop:c"));
	});

	it("a burst of requests made at once only asks the camera for the newest", async () => {
		const asked = [];
		const acquirer = createCameraAcquirer({
			getUserMedia: async (constraints) => {
				asked.push(constraints.id);
				return fakeStream(constraints.id, []);
			},
		});
		const results = await Promise.all([1, 2, 3].map((id) => acquirer.acquire({ id })));
		assert.deepEqual(results.map((r) => r.status), ["superseded", "superseded", "ok"]);
		assert.deepEqual(asked, [3]);
	});

	it("retries once on a busy camera (NotReadableError), then reports it", async () => {
		const sleeps = [];
		let calls = 0;
		const acquirer = createCameraAcquirer({
			getUserMedia: async () => {
				calls++;
				throw namedError("NotReadableError");
			},
			sleep: async (ms) => { sleeps.push(ms); },
		});
		const result = await acquirer.acquire({});
		assert.equal(result.status, "error");
		assert.equal(result.error.name, "NotReadableError");
		assert.equal(calls, 2);
		assert.deepEqual(sleeps, [600]);
	});

	it("succeeds if the camera frees up during the busy retry", async () => {
		let calls = 0;
		const acquirer = createCameraAcquirer({
			getUserMedia: async () => {
				calls++;
				if (calls === 1) throw namedError("NotReadableError");
				return fakeStream("ok", []);
			},
			sleep: async () => { },
		});
		const result = await acquirer.acquire({});
		assert.equal(result.status, "ok");
	});

	it("does not retry permission or not-found errors", async () => {
		let calls = 0;
		const acquirer = createCameraAcquirer({
			getUserMedia: async () => { calls++; throw namedError("NotAllowedError"); },
			sleep: async () => { },
		});
		const result = await acquirer.acquire({});
		assert.equal(result.error.name, "NotAllowedError");
		assert.equal(calls, 1);
	});

	it("an error in one request does not wedge the queue", async () => {
		let calls = 0;
		const acquirer = createCameraAcquirer({
			getUserMedia: async () => {
				calls++;
				if (calls === 1) throw namedError("NotFoundError");
				return fakeStream("x", []);
			},
		});
		assert.equal((await acquirer.acquire({})).status, "error");
		assert.equal((await acquirer.acquire({})).status, "ok");
	});

	it("classifies busy errors", () => {
		assert.equal(isCameraBusyError(namedError("NotReadableError")), true);
		assert.equal(isCameraBusyError(namedError("TrackStartError")), true);
		assert.equal(isCameraBusyError(namedError("NotAllowedError")), false);
		assert.equal(isCameraBusyError(null), false);
	});
});
