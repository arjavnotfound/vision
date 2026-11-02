// Pure calibration math (unit tested). Turns measurements into values for EXISTING
// settings only: head-tilt offsets/ranges, gesture thresholds, sensitivity.
// Engine conventions: degrees here; engine yaw is positive when the head turns LEFT.

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const degToRad = (deg) => deg * Math.PI / 180;

export function median(values) {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (!sorted.length) return NaN;
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(values, p) {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (!sorted.length) return NaN;
	const index = clamp(Math.round((sorted.length - 1) * p), 0, sorted.length - 1);
	return sorted[index];
}

/** Neutral pose and resting gesture ratios from samples taken while looking straight. */
export function summarizeCenter(samples) {
	return {
		yaw: median(samples.map((s) => s.yaw)),
		pitch: median(samples.map((s) => s.pitch)),
		leftEye: median(samples.map((s) => s.leftEye)),
		rightEye: median(samples.map((s) => s.rightEye)),
		mouth: median(samples.map((s) => s.mouth)),
		brow: median(samples.map((s) => s.brow)),
	};
}

/** Comfortable range: 5th–95th percentile, so one jerky frame does not count. */
export function summarizeRange(samples) {
	const yaws = samples.map((s) => s.yaw);
	const pitches = samples.map((s) => s.pitch);
	return {
		yawMin: percentile(yaws, 0.05),
		yawMax: percentile(yaws, 0.95),
		pitchMin: percentile(pitches, 0.05),
		pitchMax: percentile(pitches, 0.95),
	};
}

/**
 * Head-tilt settings from the calibration (radians, clamped to the legacy slider ranges).
 * The neutral pose becomes the centre of the screen; 85% of the comfortable span reaches the edges.
 */
export function poseSettings(center, range) {
	const yawSpan = range.yawMax - range.yawMin;
	const pitchSpan = range.pitchMax - range.pitchMin;
	const out = {};
	if (Number.isFinite(center.yaw)) out.headTiltYawOffset = degToRad(clamp(center.yaw, -45, 45));
	if (Number.isFinite(center.pitch)) out.headTiltPitchOffset = degToRad(clamp(center.pitch, -30, 30));
	if (Number.isFinite(yawSpan) && yawSpan > 4) out.headTiltYawRange = degToRad(clamp(yawSpan * 0.85, 10, 90));
	if (Number.isFinite(pitchSpan) && pitchSpan > 4) out.headTiltPitchRange = degToRad(clamp(pitchSpan * 0.85, 10, 60));
	return out;
}

/**
 * Point-tracking sensitivity suggestion from the yaw span: people with less comfortable
 * movement get a faster cursor. 60° of comfortable yaw keeps the current value.
 * Bounded to ×0.7 … ×1.6 per calibration.
 */
export function suggestSensitivityFactor(range) {
	const span = range.yawMax - range.yawMin;
	if (!Number.isFinite(span) || span < 4) return 1;
	return Math.round(clamp(60 / span, 0.7, 1.6) * 100) / 100;
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Suggested hysteresis thresholds for one gesture.
 * @param {"eye"|"mouth"|"brow"} kind
 * @param {number} neutral value at rest (from the centre step)
 * @param {number} peak most extreme value while performing the gesture
 * @returns {{ok: boolean, high?: number, low?: number, reason?: string}}
 */
export function suggestThresholds(kind, neutral, peak) {
	if (!Number.isFinite(neutral) || !Number.isFinite(peak)) {
		return { ok: false, reason: "not measured" };
	}
	if (kind === "eye") {
		// Eye ratio falls when closing. Closed when <= low; reopened when > high.
		const span = neutral - peak;
		if (span < 0.06) return { ok: false, reason: "wink not clear enough" };
		const low = clamp(peak + 0.45 * span, 0.08, 0.26);
		const high = clamp(peak + 0.65 * span, low + 0.02, 0.32);
		return { ok: true, high: round3(high), low: round3(low) };
	}
	if (kind === "mouth") {
		const span = peak - neutral;
		if (span < 0.12) return { ok: false, reason: "mouth not open enough" };
		const high = clamp(neutral + 0.55 * span, 0.12, 0.6);
		const low = clamp(neutral + 0.3 * span, 0.06, high - 0.03);
		return { ok: true, high: round3(high), low: round3(low) };
	}
	if (kind === "brow") {
		const span = peak - neutral;
		if (span < 0.03) return { ok: false, reason: "brow raise not clear enough" };
		const high = clamp(neutral + 0.6 * span, 0.2, 0.45);
		const low = clamp(neutral + 0.3 * span, 0.15, high - 0.02);
		return { ok: true, high: round3(high), low: round3(low) };
	}
	return { ok: false, reason: "unknown gesture" };
}

/** Both winks share one eye threshold pair: take the stricter (lower) values. */
export function combineEyeSuggestions(left, right) {
	const good = [left, right].filter((s) => s?.ok);
	if (!good.length) return left?.ok === false ? left : (right ?? { ok: false, reason: "not measured" });
	const low = Math.min(...good.map((s) => s.low));
	const high = Math.max(low + 0.02, Math.min(...good.map((s) => s.high)));
	return { ok: true, low: round3(low), high: round3(high) };
}

/** Settings patch for gesture thresholds (only the gestures that were measured clearly). */
export function thresholdSettings({ eye, mouth, brow }) {
	const out = {};
	if (eye?.ok) Object.assign(out, { eyeThresholdHigh: eye.high, eyeThresholdLow: eye.low });
	if (mouth?.ok) Object.assign(out, { mouthThresholdHigh: mouth.high, mouthThresholdLow: mouth.low });
	if (brow?.ok) Object.assign(out, { browThresholdHigh: brow.high, browThresholdLow: brow.low });
	return out;
}
