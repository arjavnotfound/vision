// The offline "Vision" spotter and its second check, on SAPI clips with silence around them.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readWave } = require('../app/node_modules/sherpa-onnx-node');
const { createWakeSpotter, RATE } = require('../app/src/electron-main/wake-spotter');

const modelDir = path.join(__dirname, '../app/models/kws');
const fixture = (name) => readWave(path.join(__dirname, 'fixtures/wake', name)).samples;

// The silence is digital zeros, as from a muted mic.
function hear(name, sensitivity = 'normal') {
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
	it('needs "Hey Vision" when strict', () => assert.ok(!woke(hear('vision.wav', 'strict'))));
});
