// Voice assistant settings owned by the main process: the Gemini voice, the language,
// and the voice keys (encrypted with Electron safeStorage, never in plain text).
// The agent reads voice-settings.json at the start of every voice session, so a change
// applies to the next session without restarting VISION.

const fs = require('fs');
const path = require('path');

// Gemini Live voices (same set as Gemini TTS), with Google's one-word style.
const VOICES = [
	['Aoede', 'Breezy'], ['Puck', 'Upbeat'], ['Charon', 'Informative'], ['Kore', 'Firm'],
	['Fenrir', 'Excitable'], ['Leda', 'Youthful'], ['Orus', 'Firm'], ['Zephyr', 'Bright'],
	['Callirrhoe', 'Easy-going'], ['Autonoe', 'Bright'], ['Enceladus', 'Breathy'], ['Iapetus', 'Clear'],
	['Umbriel', 'Easy-going'], ['Algieba', 'Smooth'], ['Despina', 'Smooth'], ['Erinome', 'Clear'],
	['Algenib', 'Gravelly'], ['Rasalgethi', 'Informative'], ['Laomedeia', 'Upbeat'], ['Achernar', 'Soft'],
	['Alnilam', 'Firm'], ['Schedar', 'Even'], ['Gacrux', 'Mature'], ['Pulcherrima', 'Forward'],
	['Achird', 'Friendly'], ['Zubenelgenubi', 'Casual'], ['Vindemiatrix', 'Gentle'], ['Sadachbia', 'Lively'],
	['Sadaltager', 'Knowledgeable'], ['Sulafat', 'Warm'],
].map(([name, style]) => ({ name, style }));
const LANGUAGES = ['auto', 'en', 'hi'];
// What the Settings form asks for on first voice use.
const VOICE_KEY_FIELDS = [
	{ name: 'LIVEKIT_URL', label: 'LiveKit URL', secret: false },
	{ name: 'LIVEKIT_API_KEY', label: 'LiveKit API key', secret: false },
	{ name: 'LIVEKIT_API_SECRET', label: 'LiveKit API secret', secret: true },
	{ name: 'GOOGLE_API_KEY', label: 'Gemini API key', secret: true },
];
const DEFAULTS = { voice: 'Aoede', language: 'auto' };

const matchVoice = (name) => VOICES.find((v) => v.name.toLowerCase() === String(name ?? '').trim().toLowerCase())?.name;

function normalize(settings = {}) {
	const voice = matchVoice(settings.voice);
	const language = String(settings.language ?? '').trim().toLowerCase();
	return {
		voice: voice ?? DEFAULTS.voice,
		language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
	};
}

function createVoiceSettings({ dir, safeStorage }) {
	const settingsFile = path.join(dir, 'voice-settings.json');
	const keysFile = path.join(dir, 'voice-keys.bin');

	function read() {
		try {
			return normalize(JSON.parse(fs.readFileSync(settingsFile, 'utf8')));
		} catch (_error) {
			return normalize();
		}
	}

	/** Merge a change, validate it, write atomically. Throws on an unknown voice/language. */
	function update(change = {}) {
		if (change.voice !== undefined && !matchVoice(change.voice)) {
			throw new Error(`unknown voice: ${change.voice}`);
		}
		if (change.language !== undefined && !LANGUAGES.includes(String(change.language).trim().toLowerCase())) {
			throw new Error(`unknown language: ${change.language}`);
		}
		const defined = Object.fromEntries(Object.entries(change).filter(([, value]) => value !== undefined));
		const next = normalize({ ...read(), ...defined });
		fs.mkdirSync(dir, { recursive: true });
		const tmp = `${settingsFile}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(next, null, '\t'));
		fs.renameSync(tmp, settingsFile);
		return next;
	}

	function readKeys() {
		if (!safeStorage.isEncryptionAvailable()) return {};
		try {
			return JSON.parse(safeStorage.decryptString(fs.readFileSync(keysFile)));
		} catch (_error) {
			return {};
		}
	}

	function saveKeys(keys) {
		if (!safeStorage.isEncryptionAvailable()) throw new Error('secure storage is not available');
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(keysFile, safeStorage.encryptString(JSON.stringify(keys)));
	}

	return { settingsFile, read, update, readKeys, saveKeys };
}

module.exports = { createVoiceSettings, normalize, VOICES, LANGUAGES, VOICE_KEY_FIELDS };
