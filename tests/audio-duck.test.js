// Other apps' audio while VISION listens: lowered, restored exactly, restored after a crash,
// and a level the user changed meanwhile is left alone. Fake sessions, no real audio.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAudioDuck } = require('../app/src/electron-main/audio-duck');

function fakeAudio(levels) {
	const state = levels.map(([pid, level], i) => ({ id: `s${i}`, pid, level }));
	const listSessions = () => ({
		list: state.map((s) => ({ ...s, set: (value) => ((s.level = value), true) })),
		release() {},
	});
	return { state, listSessions };
}
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vision-duck-')), 'duck.json');
const quiet = () => {};

describe('audio ducking', () => {
	it('lowers other apps, not VISION, and restores them exactly', () => {
		const audio = fakeAudio([[10, 0.8], [20, 1], [99, 1]]);
		const duck = createAudioDuck({ file: tmp(), ownPids: () => [99], log: quiet, listSessions: audio.listSessions });
		duck.set(true);
		assert.deepEqual(audio.state.map((s) => s.level), [0.2, 0.25, 1]);
		duck.set(false);
		assert.deepEqual(audio.state.map((s) => s.level), [0.8, 1, 1]);
	});

	it('restores on the next start after a crash while ducked', () => {
		const file = tmp();
		const audio = fakeAudio([[10, 0.6]]);
		createAudioDuck({ file, ownPids: () => [], log: quiet, listSessions: audio.listSessions }).set(true);
		assert.ok(fs.existsSync(file), 'levels saved before ducking');
		createAudioDuck({ file, ownPids: () => [], log: quiet, listSessions: audio.listSessions });
		assert.equal(audio.state[0].level, 0.6);
		assert.ok(!fs.existsSync(file));
	});

	it('leaves a level the user changed while ducked', () => {
		const audio = fakeAudio([[10, 1]]);
		const duck = createAudioDuck({ file: tmp(), ownPids: () => [], log: quiet, listSessions: audio.listSessions });
		duck.set(true);
		audio.state[0].level = 0.5;
		duck.set(false);
		assert.equal(audio.state[0].level, 0.5);
	});
});
