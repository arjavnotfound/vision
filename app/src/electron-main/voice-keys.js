// The keys the voice assistant needs. Dev builds read agent/.env.local (or agent/.env);
// they are never bundled. Face control never needs any of them.

const fs = require('fs');
const path = require('path');

const VOICE_KEY_NAMES = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'GOOGLE_API_KEY'];
// Passed through to the agent when set (voice, language, search engine).
const VOICE_OPTION_NAMES = ['VISION_VOICE', 'VISION_LANGUAGE', 'VISION_SEARCH_PROVIDER'];

function parseDotEnv(text) {
	const values = {};
	for (const line of text.split(/\r?\n/)) {
		const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
		if (!match) continue;
		let value = match[2].trim();
		if (/^(["']).*\1$/.test(value)) {
			value = value.slice(1, -1);
		} else {
			value = value.replace(/\s+#.*$/, '');
		}
		values[match[1]] = value;
	}
	return values;
}

function readDevKeys(agentDir) {
	const values = {};
	for (const name of ['.env', '.env.local']) {
		try {
			Object.assign(values, parseDotEnv(fs.readFileSync(path.join(agentDir, name), 'utf8')));
		} catch (_error) {
			// file missing: fine
		}
	}
	return pick(values);
}

/** keys.env next to the settings (gitignored, outside the repo): keys for this computer, read at startup. */
function readKeyFile(file) {
	try {
		return pick(parseDotEnv(fs.readFileSync(file, 'utf8')));
	} catch (_error) {
		return {};
	}
}

/** Enough of a saved key to recognise it, never enough to use it. */
function maskKey(value, showAll = false) {
	const text = String(value ?? '');
	if (!text || showAll) return text;
	return text.length > 8 ? `${'•'.repeat(6)}${text.slice(-4)}` : '•'.repeat(6);
}

function pick(values) {
	const out = {};
	for (const name of [...VOICE_KEY_NAMES, ...VOICE_OPTION_NAMES]) {
		const value = process.env[name] || values[name];
		if (value) out[name] = value;
	}
	return out;
}

const hasVoiceKeys = (keys) => VOICE_KEY_NAMES.every((name) => Boolean(keys[name]));

module.exports = { parseDotEnv, readDevKeys, readKeyFile, maskKey, hasVoiceKeys, VOICE_KEY_NAMES };
