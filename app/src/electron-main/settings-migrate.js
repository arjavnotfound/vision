// One settings store: vision-settings.json (globalSettings). The island window used to keep
// its own copy in localStorage (dwell 900 ms vs the face window's 800 ms, wake sensitivity,
// island edge); those values move here once, the first time the island window starts.

const DWELL_DEFAULT_MS = 800;
const DWELL_MIN_MS = 600;
const DWELL_MAX_MS = 1500;
const OLD_CONSOLE_DWELL_MS = 900;
const WAKE_SENSITIVITIES = ['relaxed', 'normal'];

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

/** Clean values from a settings write: a saved "strict" becomes "normal". */
function sanitizeGlobal(global = {}) {
	if (global.wakeSensitivity !== undefined) global.wakeSensitivity = normalizeWake(global.wakeSensitivity);
	return global;
}

module.exports = {
	islandSettings, migrateIslandSettings, sanitizeGlobal, normalizeWake,
	DWELL_DEFAULT_MS, DWELL_MIN_MS, DWELL_MAX_MS,
};
