// Pure engine modules used by vision.js (loaded with Vision.loadCoreModules()).
// Nothing here touches the DOM, so everything is unit tested under Node.

export { createPruner, legacyPruneIndexes } from "./tracking/prune.js";
export { createFaceLock, faceBox } from "./tracking/face-select.js";
export { accelerate, computeCursorDelta } from "./tracking/cursor-motion.js";
export { createCameraAcquirer, isCameraBusyError, stopStreamTracks } from "./camera/acquirer.js";
export { OneEuroFilter, LowPassFilter } from "./filters/one-euro.js";
export { signedDistancePointLine, getAspectMetrics } from "./gestures/geometry.js";
export { DEFAULT_THRESHOLDS, BLINK_REJECT_DURATION_MS, detectBlinks, detectMouthOpen, detectForeheadRaised } from "./gestures/detect.js";
export { stepEyebrowHold, stepSleepHold, EYEBROW_HOLD_MS, SLEEP_HOLD_MS } from "./gestures/hold.js";
export { resolveClickButton, mouthScrollDirection, SCROLL_PITCH_THRESHOLD_DEG } from "./gestures/arbitration.js";
export { gestureBindings, clickingModeLabel, GESTURES } from "./gestures/bindings.js";
export { computeHeadTilt, createHeadTiltSmoother, HEAD_TILT_FILTER, radToDeg, degToRad } from "./pose/head-tilt.js";
export { measureBrightness, assessFraming, FRAMING_LIMITS } from "./diagnostics/framing.js";
export { createEmitter } from "./engine/emitter.js";
// QA only (see scripts/qa/synthetic-e2e.js)
export { createSyntheticFace, syntheticPrediction, scriptedPose } from "./testing/synthetic-face.js";
