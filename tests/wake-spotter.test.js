// The offline "Vision" spotter and its second check, on SAPI clips with silence around them.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readWave } = require('../app/node_modules/sherpa-onnx-node');
const { createWakeSpotter, createWakeGate, RATE } = require('../app/src/electron-main/wake-spotter');

const modelDir = path.join(__dirname, '../app/models/kws');
const fixture = (name) => readWave(path.join(__dirname, 'fixtures/wake', name)).samples;

// The silence is digital zeros, as from a muted mic. Each clip is decoded once.
const heardCache = new Map();
function hear(name, sensitivity = 'normal') {
	const key = `${name}|${sensitivity}`;
	if (!heardCache.has(key)) heardCache.set(key, decode(name, sensitivity));
	return heardCache.get(key);
}
function decode(name, sensitivity) {
	const spotter = createWakeSpotter({ modelDir, sensitivity });
	const audio = new Float32Array(3 * RATE + fixture(name).length);
	audio.set(fixture(name), 2 * RATE);
	const heard = [];
	for (let i = 0; i < audio.length; i += 1600) heard.push(...spotter.accept(audio.subarray(i, i + 1600)));
	return heard;
}
const woke = (heard) => heard.some((h) => (h.keyword === 'vision' || h.keyword === 'hey_vision') && h.ok);

describe('wake spotter', () => {
	it('wakes on "Vision" after a pause', () => assert.ok(woke(hear('vision.wav'))));
	it('rejects "television" in the second check', () => assert.ok(!woke(hear('television.wav'))));
	it('rejects the name "Vishnu" in the names check', () => {
		const heard = hear('vishnu.wav');
		assert.ok(heard.some((h) => h.keyword === 'vision' && !h.ok), 'the first spotter hears "vision"');
		assert.ok(!woke(heard));
	});
	it('rejects "my vision is blurry"', () => assert.ok(!woke(hear('my-vision-is-blurry.wav'))));
	it('hears "stop" right after "Vision"', () => {
		const heard = hear('vision-stop.wav');
		assert.ok(woke(heard));
		assert.ok(heard.some((h) => h.keyword === 'stop'));
	});
	it('treats a saved "strict" as normal: plain "Vision" still wakes', () => assert.ok(woke(hear('vision.wav', 'strict'))));
	it('hears "Hey Vision" as hey_vision', () => assert.ok(hear('hey-vision.wav').some((h) => h.keyword === 'hey_vision' && h.ok)));
	it('hears "menu" right after "Vision"', () => {
		const heard = hear('vision-menu.wav');
		assert.ok(woke(heard));
		assert.ok(heard.some((h) => h.keyword === 'menu'));
	});
});

// Replays what the spotter heard in a clip through the gate, one keyword per 100 ms.
function actions(name, gateOptions, open = false) {
	const gate = createWakeGate(gateOptions);
	return hear(name).map((h, i) => gate.decide(h, { open, now: 1000 + i * 100 }));
}

describe('wake gate', () => {
	it('"Hey Vision" by default: plain "Vision" does not wake, "Hey Vision" does', () => {
		assert.ok(!actions('vision.wav').includes('wake'));
		assert.ok(actions('hey-vision.wav').includes('wake'));
	});
	it('"Vision" as the phrase wakes on both', () => {
		assert.ok(actions('vision.wav', { phrase: 'vision' }).includes('wake'));
		assert.ok(actions('hey-vision.wav', { phrase: 'vision' }).includes('wake'));
	});
	it('ignores a second wake word while a session is open, with no restart', () => {
		assert.deepEqual([...new Set(actions('hey-vision.wav', {}, true))], ['ignore']);
		assert.deepEqual([...new Set(actions('vision.wav', { phrase: 'vision' }, true))], ['ignore']);
	});
	it('acts on "Vision, stop" during a session under either phrase', () => {
		assert.ok(actions('vision-stop.wav', {}, true).includes('stop'));
		assert.ok(actions('vision-stop.wav', { phrase: 'vision' }, true).includes('stop'));
		assert.ok(!actions('vision-stop.wav', {}, true).includes('wake'));
	});
	it('opens the menu on "Vision, menu"', () => assert.ok(actions('vision-menu.wav', {}, true).includes('menu')));
	it('ignores "stop" with no "Vision" just before it', () => {
		const gate = createWakeGate();
		assert.equal(gate.decide({ keyword: 'stop', ok: true }, { now: 10_000 }), 'ignore');
		gate.decide({ keyword: 'vision', ok: true }, { now: 10_000 });
		assert.equal(gate.decide({ keyword: 'stop', ok: true }, { now: 13_000 }), 'ignore');
	});
	it('rejected hits never wake or arm the command window', () => {
		const gate = createWakeGate({ phrase: 'vision' });
		assert.equal(gate.decide({ keyword: 'vision', ok: false }, { now: 0 }), 'ignore');
		assert.equal(gate.decide({ keyword: 'stop', ok: true }, { now: 100 }), 'ignore');
	});
});
