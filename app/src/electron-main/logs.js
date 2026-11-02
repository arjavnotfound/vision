// Logs in %APPDATA%\VISION\logs: main.log (this process) and agent.log (the voice agent).
// The installed app has no console, so console output is copied to main.log.

const fs = require('fs');
const path = require('path');
const util = require('util');

const MAX_BYTES = 5 * 1024 * 1024;

/** Keep the previous run's log as <name>.old.log once it grows past 5 MB. */
function rotate(file) {
	try {
		if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file.replace(/\.log$/, '.old.log'));
	} catch (_error) {
		// no file yet
	}
	return file;
}

function installFileLogging(logDir) {
	fs.mkdirSync(logDir, { recursive: true });
	const stream = fs.createWriteStream(rotate(path.join(logDir, 'main.log')), { flags: 'a' });
	stream.on('error', () => {});
	stream.write(`\n----- VISION started ${new Date().toISOString()} -----\n`);
	for (const level of ['log', 'info', 'warn', 'error']) {
		const original = console[level].bind(console);
		console[level] = (...args) => {
			original(...args);
			stream.write(`[${new Date().toISOString().slice(11, 23)}] ${util.format(...args)}\n`);
		};
	}
	return { agentLogFile: rotate(path.join(logDir, 'agent.log')) };
}

module.exports = { installFileLogging };
