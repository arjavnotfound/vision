// One settings store: vision-settings.json (globalSettings). The island window used to keep
// its own copy in localStorage (dwell 900 ms vs the face window's 800 ms, wake sensitivity,
// island edge); those values move here once, the first time the island window starts.

const DWELL_DEFAULT_MS = 800;
const DWELL_MIN_MS = 600;
const DWELL_MAX_MS = 1500;
const OLD_CONSOLE_DWELL_MS = 900;
const WAKE_SENSITIVITIES = ['relaxed', 'normal'];
// VISION's own voice. Never below 10: a silent VISION can't tell anyone what went wrong.
const VOLUME_DEFAULT = 100;
const VOLUME_MIN = 10;
const VOLUME_MAX = 100;
const VOLUME_STEP = 20;
// The wake / listening / done / error sounds: on, medium.
const SOUND_VOLUME_DEFAULT = 60;

const clampDwell = (ms) => Math.min(DWELL_MAX_MS, Math.max(DWELL_MIN_MS, Math.round(ms)));

// "strict" (only "Hey Vision" woke) was removed: it locked people out in music.
function normalizeWake(value) {
	return WAKE_SENSITIVITIES.includes(value) ? value : 'normal';
}

/** The island window's settings, read from the one store. */
function islandSettings(global = {}) {
	return {
		dwellTime: Number.isFinite(global.dwellTime) ? clampDwell(global.dwellTime) : DWELL_DEFAULT_MS,
		wakeSensitivity: normalizeWake(global.wakeSensitivity),
		islandEdge: global.islandEdge === 'bottom' ? 'bottom' : 'top',
		voiceVolume: parseVolume(global.voiceVolume, VOLUME_DEFAULT) ?? VOLUME_DEFAULT,
		soundsOn: global.soundsOn !== false,
		soundVolume: parseVolume(global.soundVolume, SOUND_VOLUME_DEFAULT) ?? SOUND_VOLUME_DEFAULT,
		migrated: global.islandSettingsMigrated === true,
	};
}

/**
 * Patch for globalSettings that moves the island window's old localStorage values in.
 * Runs once (islandSettingsMigrated). A dwell time the person changed in the island
 * window (not the old 900 default) wins only when the face window still has its default.
 */
function migrateIslandSettings(global = {}, old = {}) {
	if (global.islandSettingsMigrated === true) return null;
	const patch = { islandSettingsMigrated: true };
	const oldDwell = Number(old?.dwellMs);
	const faceDwellDefault = global.dwellTime === undefined || global.dwellTime === DWELL_DEFAULT_MS;
	if (Number.isFinite(oldDwell) && oldDwell !== OLD_CONSOLE_DWELL_MS && faceDwellDefault) {
		patch.dwellTime = clampDwell(oldDwell);
	}
	if (global.wakeSensitivity === undefined && old?.wakeSensitivity !== undefined) {
		patch.wakeSensitivity = normalizeWake(old.wakeSensitivity);
	}
	if (global.islandEdge === undefined && (old?.islandEdge === 'top' || old?.islandEdge === 'bottom')) {
		patch.islandEdge = old.islandEdge;
	}
	return patch;
}

/**
 * A volume from the voice assistant: 10-100, or louder / quieter from `current`.
 * Returns null for anything else (out of range, not a number).
 */
function parseVolume(value, current = VOLUME_DEFAULT) {
	const text = String(value ?? '').trim().toLowerCase();
	const base = Number.isFinite(current) ? current : VOLUME_DEFAULT;
	if (text === 'louder' || text === 'quieter') {
		const next = base + (text === 'louder' ? VOLUME_STEP : -VOLUME_STEP);
		return Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, next));
	}
	const number = Number(text);
	if (text === '' || !Number.isFinite(number)) return null;
	const rounded = Math.round(number);
	return rounded >= VOLUME_MIN && rounded <= VOLUME_MAX ? rounded : null;
}

/** Clean values from a settings write: a saved "strict" becomes "normal". */
function sanitizeGlobal(global = {}) {
	if (global.wakeSensitivity !== undefined) global.wakeSensitivity = normalizeWake(global.wakeSensitivity);
	if (global.voiceVolume !== undefined) global.voiceVolume = parseVolume(global.voiceVolume) ?? VOLUME_DEFAULT;
	if (global.soundVolume !== undefined) global.soundVolume = parseVolume(global.soundVolume) ?? SOUND_VOLUME_DEFAULT;
	if (global.soundsOn !== undefined) global.soundsOn = global.soundsOn !== false;
	return global;
}

module.exports = {
	islandSettings, migrateIslandSettings, sanitizeGlobal, normalizeWake, parseVolume,
	DWELL_DEFAULT_MS, DWELL_MIN_MS, DWELL_MAX_MS,
};
