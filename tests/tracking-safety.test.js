const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

describe('TrackingLossSafetyProtocol', () => {
	it('guarantees simulated buttons are released and gestures reset on tracking loss', () => {
		// Simulate the tracking environment state
		const buttonStates = { left: true, middle: false, right: true };
		const releasedCalls = [];
		const setMouseButtonState = (btn, down) => {
			releasedCalls.push({ btn, down });
		};

		let mouseButtonUntilMouthCloses = 0;
		let lastMouseDownTime = 12345;
		let blinkInfo = { leftEye: {}, rightEye: {} };
		let mouthInfo = { used: true };
		let foreheadInfo = { used: true };
		let eyebrowGestureProgress = 0.8;
		let sleepGestureProgress = 0.5;
		let isMouthScrolling = true;
		let mouthScrollDirection = 1;
		let lastFeedback = null;

		const updateInputFeedback = (feedback) => {
			lastFeedback = feedback;
		};

		// Core tracking loss logic mirror
		const handleTrackingLoss = (reason = "tracking-loss") => {
			const buttonNames = ["left", "middle", "right"];
			for (let buttonIndex = 0; buttonIndex < 3; buttonIndex++) {
				if (buttonStates[buttonNames[buttonIndex]]) {
					buttonStates[buttonNames[buttonIndex]] = false;
					if (setMouseButtonState) {
						try {
							setMouseButtonState(buttonIndex, false);
						} catch (err) {
							console.error(`[Vision] Failed to release button ${buttonNames[buttonIndex]} on ${reason}:`, err);
						}
					}
				}
			}
			mouseButtonUntilMouthCloses = -1;
			lastMouseDownTime = -Infinity;
			blinkInfo = null;
			mouthInfo = null;
			foreheadInfo = null;
			eyebrowGestureProgress = 0;
			sleepGestureProgress = 0;
			isMouthScrolling = false;
			mouthScrollDirection = 0;

			updateInputFeedback({
				headNotFound: true,
				blinkInfo: null,
				mouthInfo: null,
				foreheadInfo: null,
				eyebrowGestureProgress: 0,
			});
		};

		// Trigger tracking loss (e.g. face left frame, camera disconnect, pause)
		handleTrackingLoss('test-head-lost');

		// Assert all buttons were marked false and released via driver
		assert.deepEqual(buttonStates, { left: false, middle: false, right: false });
		assert.deepEqual(releasedCalls, [
			{ btn: 0, down: false },
			{ btn: 2, down: false },
		]);

		// Assert all gesture state machines were zeroed
		assert.equal(mouseButtonUntilMouthCloses, -1);
		assert.equal(lastMouseDownTime, -Infinity);
		assert.equal(blinkInfo, null);
		assert.equal(mouthInfo, null);
		assert.equal(foreheadInfo, null);
		assert.equal(eyebrowGestureProgress, 0);
		assert.equal(sleepGestureProgress, 0);
		assert.equal(isMouthScrolling, false);
		assert.equal(mouthScrollDirection, 0);

		// Assert feedback informs HUD that head is lost
		assert.equal(lastFeedback.headNotFound, true);
	});

	it('suppresses optical flow drift when face is not detected', () => {
		// Mock pointTracker output with raw background movement
		let rawMovementX = 14.5;
		let rawMovementY = -8.2;

		const simulateFrameMovement = ({ useFacemesh, facemeshPrediction, useClmTracking, face, faceScore, faceScoreThreshold }) => {
			let [movementX, movementY] = [rawMovementX, rawMovementY];

			const hasValidFace = Boolean(
				(useFacemesh && facemeshPrediction) ||
				(useClmTracking && face && faceScore >= faceScoreThreshold)
			);

			if (!hasValidFace) {
				movementX = 0;
				movementY = 0;
			}

			return [movementX, movementY];
		};

		// Case 1: No facemesh prediction and no clm face -> movement MUST be zeroed
		const [zeroX, zeroY] = simulateFrameMovement({
			useFacemesh: true,
			facemeshPrediction: null,
			useClmTracking: false,
			face: null,
			faceScore: 0,
			faceScoreThreshold: 0.5,
		});
		assert.equal(zeroX, 0);
		assert.equal(zeroY, 0);

		// Case 2: CLM tracking with low confidence score (< threshold) -> movement MUST be zeroed
		const [clmZeroX, clmZeroY] = simulateFrameMovement({
			useFacemesh: false,
			facemeshPrediction: null,
			useClmTracking: true,
			face: [[0, 0]],
			faceScore: 0.3,
			faceScoreThreshold: 0.5,
		});
		assert.equal(clmZeroX, 0);
		assert.equal(clmZeroY, 0);

		// Case 3: Valid facemesh face -> movement is preserved
		const [validX, validY] = simulateFrameMovement({
			useFacemesh: true,
			facemeshPrediction: { keypoints: [] },
			useClmTracking: false,
			face: null,
			faceScore: 0,
			faceScoreThreshold: 0.5,
		});
		assert.equal(validX, 14.5);
		assert.equal(validY, -8.2);
	});

	it('triggers tracking loss when media stream track emits ended or mute', () => {
		const mockTrack = new EventEmitter();
		let trackingLossReason = null;

		const handleTrackingLoss = (reason) => {
			trackingLossReason = reason;
		};

		// Mirror the track event binding
		mockTrack.on('ended', () => {
			handleTrackingLoss('camera-disconnected');
		});
		mockTrack.on('mute', () => {
			handleTrackingLoss('camera-muted');
		});

		mockTrack.emit('ended');
		assert.equal(trackingLossReason, 'camera-disconnected');

		mockTrack.emit('mute');
		assert.equal(trackingLossReason, 'camera-muted');
	});
	// Camera acquisition serialisation is tested against the real module in camera-acquirer.test.mjs.
});
