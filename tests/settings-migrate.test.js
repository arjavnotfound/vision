// One settings store: moving the island window's old localStorage settings into
// vision-settings.json. Fixtures are copies of this dev machine's real files (T10).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { islandSettings, migrateIslandSettings, sanitizeGlobal } = require('../app/src/electron-main/settings-migrate');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'settings-T10', name), 'utf8'));

describe('settings migration', () => {
	it('moves real old settings in once, keeping the face window dwell time', () => {
		const global = fixture('vision-settings.json').globalSettings;
		const old = fixture('console-localstorage.json');
		const patch = migrateIslandSettings(global, old);
		// The face window already had 1500 ms: it wins over the island's 1100 ms.
		assert.equal(patch.dwellTime, undefined);
		assert.equal(patch.wakeSensitivity, 'normal', 'a saved "strict" becomes Normal');
		assert.equal(patch.islandEdge, 'bottom');
		const merged = { ...global, ...patch };
		assert.deepEqual(islandSettings(merged), { dwellTime: 1500, wakeSensitivity: 'normal', islandEdge: 'bottom', voiceVolume: 100, migrated: true });
		assert.equal(migrateIslandSettings(merged, old), null, 'runs only once');
	});
	it('takes a changed island dwell time when the face window has the default', () => {
		assert.equal(migrateIslandSettings({ dwellTime: 800 }, { dwellMs: 1200 }).dwellTime, 1200);
		assert.equal(migrateIslandSettings({}, { dwellMs: 5000 }).dwellTime, 1500);
		assert.equal(migrateIslandSettings({}, { dwellMs: 900 }).dwellTime, undefined, 'the old 900 default is not a choice');
	});
	it('keeps relaxed, and gives one default dwell time when nothing is saved', () => {
		assert.equal(migrateIslandSettings({}, { wakeSensitivity: 'relaxed' }).wakeSensitivity, 'relaxed');
		assert.deepEqual(islandSettings({}), { dwellTime: 800, wakeSensitivity: 'normal', islandEdge: 'top', voiceVolume: 100, migrated: false });
	});
	it('turns a saved strict into normal on any write', () => {
		assert.equal(sanitizeGlobal({ wakeSensitivity: 'strict' }).wakeSensitivity, 'normal');
		assert.equal(sanitizeGlobal({ wakeSensitivity: 'relaxed' }).wakeSensitivity, 'relaxed');
		assert.equal('wakeSensitivity' in sanitizeGlobal({ dwellTime: 900 }), false);
	});
});
