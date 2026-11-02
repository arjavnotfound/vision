// "Hold" gestures: progress that fills while a gesture is held and drains when released.

export const EYEBROW_HOLD_MS = 3000;
export const EYEBROW_COOLDOWN_MS = 3000;
export const SLEEP_HOLD_MS = 2000;

/**
 * Raise eyebrows for ~3 s to open the on-screen keyboard.
 * Fills at 1/duration per ms while raised (and allowed, and not cooling down);
 * drains 1.5x as fast otherwise.
 * @returns {{progress: number, cooldownUntil: number, completed: boolean}}
 */
export function stepEyebrowHold({ progress, cooldownUntil, raised, allowed, now, dt, duration = EYEBROW_HOLD_MS }) {
	if (raised && allowed && now >= cooldownUntil) {
		progress += dt / duration;
		progress = Math.min(progress, 1);
	} else {
		progress -= (dt / duration) * 1.5;
		progress = Math.max(progress, 0);
	}
	let completed = false;
	if (progress >= 1) {
		progress = 0;
		cooldownUntil = now + EYEBROW_COOLDOWN_MS;
		completed = true;
	}
	return { progress, cooldownUntil, completed };
}

/**
 * Close both eyes for ~2 s to toggle pause (when enabled).
 * @returns {{progress: number, completed: boolean}}
 */
export function stepSleepHold({ progress, bothClosed, dt, duration = SLEEP_HOLD_MS }) {
	if (bothClosed) {
		progress += dt / duration;
		progress = Math.min(progress, 1);
	} else {
		progress -= dt / duration;
		progress = Math.max(progress, 0);
	}
	let completed = false;
	if (progress >= 1) {
		progress = 0;
		completed = true;
	}
	return { progress, completed };
}
