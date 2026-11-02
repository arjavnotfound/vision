// Runs the voice agent (agent/) as a hidden child process and keeps it alive.
// Replaces the old PowerShell launcher's job: start it, restart it silently when it
// dies (the LiveKit worker even exits with code 0 after a long Wi-Fi loss), give up
// after a few quick crashes, and stop exactly the tree it started on quit.

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

/** Where the Python interpreter and the agent sources are, dev or installed. */
function resolveAgentCommand({ isPackaged, appPath, resourcesPath }) {
	if (isPackaged) {
		const cwd = path.join(resourcesPath, 'agent');
		// -E -s: ignore any PYTHON* variables and user site-packages on this machine.
		return { cwd, exe: path.join(resourcesPath, 'agent-runtime', 'python.exe'), args: ['-E', '-s', 'src/agent.py', 'start'] };
	}
	const cwd = path.join(appPath, '..', 'agent');
	return { cwd, exe: path.join(cwd, '.venv', 'Scripts', 'python.exe'), args: ['src/agent.py', 'start'] };
}

function killTree(pid) {
	if (!pid) return;
	if (process.platform === 'win32') {
		// By PID only, never by process name.
		execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
	} else {
		try {
			process.kill(pid, 'SIGTERM');
		} catch (_error) {
			// already gone
		}
	}
}

function createAgentSupervisor({
	command,
	getEnv,
	logFile,
	log = console.log,
	maxRestarts = 3,
	stableMs = 10 * 60 * 1000,
	restartDelayMs = 2000,
	onGiveUp = () => {},
	spawnFn = spawn,
	killFn = killTree,
	now = Date.now,
}) {
	let child = null;
	let stopping = false;
	let restarts = 0;
	let startedAt = 0;
	let timer = null;

	const writeLog = (line) => {
		if (!logFile) return;
		try {
			fs.appendFileSync(logFile, line);
		} catch (_error) {
			// logging must never stop the agent
		}
	};

	function start() {
		if (child || stopping) return false;
		if (!fs.existsSync(command.exe)) {
			log(`[VISION] Voice agent not found: ${command.exe}`);
			return false;
		}
		writeLog(`\n----- agent started ${new Date().toISOString()} -----\n`);
		startedAt = now();
		const proc = spawnFn(command.exe, command.args, {
			cwd: command.cwd,
			env: { ...process.env, PYTHONUNBUFFERED: '1', ...getEnv() },
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		child = proc;
		proc.stdout?.on('data', (chunk) => writeLog(chunk));
		proc.stderr?.on('data', (chunk) => writeLog(chunk));
		proc.on('error', (error) => log(`[VISION] Voice agent failed to start: ${error.message}`));
		proc.on('exit', (code) => onExit(proc, code));
		log(`[VISION] Voice agent started (pid ${proc.pid})`);
		return true;
	}

	function onExit(proc, code) {
		if (proc !== child) return;
		child = null;
		if (stopping) return;
		// A long healthy run earns a fresh restart budget.
		if (now() - startedAt > stableMs) restarts = 0;
		if (restarts >= maxRestarts) {
			log(`[VISION] Voice agent stopped again (code ${code}); giving up after ${maxRestarts} restarts`);
			onGiveUp();
			return;
		}
		restarts++;
		log(`[VISION] Voice agent exited (code ${code}); restart ${restarts}/${maxRestarts}`);
		timer = setTimeout(() => {
			timer = null;
			start();
		}, restartDelayMs);
	}

	function stop() {
		stopping = true;
		clearTimeout(timer);
		if (child) {
			killFn(child.pid);
			child = null;
		}
	}

	/** Start again after a give-up or a settings change (new keys, voice, language). */
	function restart() {
		stop();
		stopping = false;
		restarts = 0;
		return start();
	}

	return { start, stop, restart, isRunning: () => Boolean(child) };
}

module.exports = { createAgentSupervisor, resolveAgentCommand, killTree };
