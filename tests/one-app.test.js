// One-app VISION: the gesture policy (voice on / remapped gestures) and the localhost bus.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { allowGestureButton, allowGestureScroll } = require('../app/src/electron-main/gesture-policy');
const { createVisionBus } = require('../app/src/electron-main/vision-bus');

describe('gesture policy: mouth conflict with the voice assistant', () => {
	it('blocks mouth clicks while the assistant mic is live', () => {
		for (const mode of ['open-mouth', 'open-mouth-simple', 'open-mouth-ignoring-eyes']) {
			assert.equal(allowGestureButton({ button: 0, down: true, clickingMode: mode, voiceLive: true }).allowed, false, mode);
			assert.equal(allowGestureButton({ button: 0, down: true, clickingMode: mode, voiceLive: false }).allowed, true, mode);
		}
	});
	it('keeps winks working while the voice is on', () => {
		assert.equal(allowGestureButton({ button: 0, down: true, clickingMode: 'blink', voiceLive: true }).allowed, true);
		assert.equal(allowGestureButton({ button: 2, down: true, clickingMode: 'blink', voiceLive: true }).allowed, true);
	});
	it('always allows releasing a button', () => {
		assert.equal(allowGestureButton({ button: 0, down: false, clickingMode: 'open-mouth', voiceLive: true }).allowed, true);
		assert.equal(allowGestureButton({ button: 2, down: false, clickingMode: 'blink', controlMap: { rightClick: 'brow' } }).allowed, true);
	});
	it('blocks mouth + tilt scrolling while the voice is on', () => {
		assert.equal(allowGestureScroll({ voiceLive: true }).allowed, false);
		assert.equal(allowGestureScroll({ voiceLive: false }).allowed, true);
	});
});

describe('gesture policy: adaptive control map', () => {
	it('switches off an unreliable right wink once right click moved elsewhere', () => {
		assert.equal(allowGestureButton({ button: 2, down: true, clickingMode: 'blink', controlMap: { rightClick: 'brow' } }).allowed, false);
		assert.equal(allowGestureButton({ button: 2, down: true, clickingMode: 'blink', controlMap: { rightClick: 'voice' } }).allowed, false);
		assert.equal(allowGestureButton({ button: 2, down: true, clickingMode: 'blink', controlMap: { rightClick: 'rightWink' } }).allowed, true);
		assert.equal(allowGestureButton({ button: 0, down: true, clickingMode: 'blink', controlMap: { rightClick: 'brow' } }).allowed, true);
	});
	it('switches off mouth scrolling when scroll moved to the voice', () => {
		assert.equal(allowGestureScroll({ voiceLive: false, controlMap: { scroll: 'voice' } }).allowed, false);
	});
});

function request(port, { method = 'GET', path = '/state', token, body } = {}) {
	return new Promise((resolve, reject) => {
		const req = http.request({ host: '127.0.0.1', port, method, path, headers: { ...(token ? { 'x-vision-token': token } : {}), 'content-type': 'application/json' } }, (res) => {
			let data = '';
			res.on('data', (c) => { data += c; });
			res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
		});
		req.on('error', reject);
		if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
		req.end();
	});
}

describe('VISION bus', () => {
	it('requires the token, and routes assistant state and commands', async () => {
		const seen = { assistant: [], commands: [] };
		const bus = createVisionBus({
			port: 0,
			token: 'secret',
			log: () => { },
			onAssistant: (s) => seen.assistant.push(s),
			onCommand: (cmd, value) => { seen.commands.push([cmd, value]); return { done: cmd }; },
			getState: () => ({ tracking: true }),
		});
		const port = await bus.start();
		try {
			assert.equal((await request(port)).status, 403);
			assert.equal((await request(port, { token: 'wrong' })).status, 403);
			assert.deepEqual((await request(port, { token: 'secret' })).body, { ok: true, state: { tracking: true } });
			const live = await request(port, { method: 'POST', path: '/assistant', token: 'secret', body: { connected: true, live: true } });
			assert.equal(live.status, 200);
			assert.deepEqual(seen.assistant, [{ connected: true, live: true }]);
			const cmd = await request(port, { method: 'POST', path: '/command', token: 'secret', body: { cmd: 'pause' } });
			assert.deepEqual(cmd.body, { ok: true, done: 'pause' });
			assert.equal((await request(port, { method: 'POST', path: '/command', token: 'secret', body: {} })).status, 400);
			assert.equal((await request(port, { method: 'POST', path: '/command', token: 'secret', body: 'not json' })).status, 400);
			assert.equal((await request(port, { path: '/nope', token: 'secret' })).status, 404);
		} finally {
			await bus.close();
		}
	});
	it('refuses to start without a token', () => {
		assert.throws(() => createVisionBus({ port: 0 }), /token/);
	});
});
