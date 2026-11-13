// Main-process side of the wake word: starts the spotter's utility process, forwards mic
// audio to it, and restarts it if it dies.
const { utilityProcess } = require('electron');
const path = require('path');

const SENSITIVITIES = new Set(['relaxed', 'normal', 'strict']);

function createWakeHost({ modelDir, onHeard }) {
	let child = null;
	let sensitivity = 'normal';
	let stopped = false;
	let restarts = 0;

	function start() {
		child = utilityProcess.fork(path.join(__dirname, 'wake-process.js'), [], { serviceName: 'VISION wake word' });
		child.on('message', (message) => {
			if (message?.type === 'heard') onHeard({ keyword: message.keyword, ok: Boolean(message.ok) });
			else if (message?.type === 'ready') {
				restarts = 0;
				console.log(`[VISION] Wake word listening (${message.sensitivity})`);
			}
			else if (message?.type === 'error') console.error('[VISION] Wake word failed to load:', message.message);
		});
		child.on('exit', (code) => {
			child = null;
			if (stopped) return;
			console.error(`[VISION] Wake word process exited (${code})`);
			// Back off, but never give up: the wake word is how a hands-free user gets in.
			setTimeout(() => !stopped && start(), Math.min(30_000, 1000 * 2 ** restarts++));
		});
		child.postMessage({ type: 'config', modelDir, sensitivity });
	}

	start();
	return {
		audio(samples) {
			if (child && samples instanceof Float32Array && samples.length <= 16000) child.postMessage({ type: 'audio', samples });
		},
		setSensitivity(next) {
			if (!SENSITIVITIES.has(next) || next === sensitivity) return;
			sensitivity = next;
			child?.postMessage({ type: 'config', modelDir, sensitivity });
		},
		stop() {
			stopped = true;
			child?.kill();
		},
	};
}

module.exports = { createWakeHost };
