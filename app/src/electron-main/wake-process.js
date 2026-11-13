// Utility process: runs the offline "Vision" spotter away from the main process, so its
// CPU work never delays the input-safety code there.
const { createWakeSpotter } = require('./wake-spotter.js');

let spotter = null;
process.parentPort.on('message', ({ data }) => {
	if (data?.type === 'config') {
		try {
			spotter = createWakeSpotter({ modelDir: data.modelDir, sensitivity: data.sensitivity });
			process.parentPort.postMessage({ type: 'ready', sensitivity: data.sensitivity });
		} catch (error) {
			spotter = null;
			process.parentPort.postMessage({ type: 'error', message: String(error?.message || error) });
		}
	} else if (data?.type === 'audio' && spotter && data.samples instanceof Float32Array) {
		for (const heard of spotter.accept(data.samples)) process.parentPort.postMessage({ type: 'heard', ...heard });
	}
});
