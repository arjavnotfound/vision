// Voice / language settings and the encrypted voice keys (fake safeStorage).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createVoiceSettings, VOICES } = require('../app/src/electron-main/voice-settings');

const fakeSafeStorage = {
	isEncryptionAvailable: () => true,
	encryptString: (text) => Buffer.from(text, 'utf8').reverse(),
	decryptString: (buffer) => Buffer.from(buffer).reverse().toString('utf8'),
};
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vision-voice-'));

describe('voice settings', () => {
	it('defaults to the current voice and auto language', () => {
		assert.deepEqual(createVoiceSettings({ dir: tempDir(), safeStorage: fakeSafeStorage }).read(), { voice: 'Aoede', language: 'auto' });
	});
	it('saves a voice (any case) and a language, and reads them back', () => {
		const dir = tempDir();
		const settings = createVoiceSettings({ dir, safeStorage: fakeSafeStorage });
		settings.update({ voice: 'puck' });
		settings.update({ language: 'hi', voice: undefined });
		assert.deepEqual(createVoiceSettings({ dir, safeStorage: fakeSafeStorage }).read(), { voice: 'Puck', language: 'hi' });
	});
	it('refuses unknown voices and languages without changing anything', () => {
		const settings = createVoiceSettings({ dir: tempDir(), safeStorage: fakeSafeStorage });
		assert.throws(() => settings.update({ voice: 'Robot' }), /unknown voice/);
		assert.throws(() => settings.update({ language: 'fr' }), /unknown language/);
		assert.deepEqual(settings.read(), { voice: 'Aoede', language: 'auto' });
	});
	it('falls back to defaults when the file is broken', () => {
		const dir = tempDir();
		fs.writeFileSync(path.join(dir, 'voice-settings.json'), '{not json');
		assert.equal(createVoiceSettings({ dir, safeStorage: fakeSafeStorage }).read().voice, 'Aoede');
	});
	it('stores keys encrypted, never as plain text', () => {
		const dir = tempDir();
		const settings = createVoiceSettings({ dir, safeStorage: fakeSafeStorage });
		settings.saveKeys({ GOOGLE_API_KEY: 'secret-value' });
		assert.ok(!fs.readFileSync(path.join(dir, 'voice-keys.bin'), 'utf8').includes('secret-value'));
		assert.deepEqual(settings.readKeys(), { GOOGLE_API_KEY: 'secret-value' });
	});
	it('lists 30 voices with unique names', () => {
		assert.equal(new Set(VOICES.map((v) => v.name)).size, 30);
	});
});
