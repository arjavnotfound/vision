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
		// -u: unbuffered output for agent.log (-E also ignores PYTHONUNBUFFERED).
		return { cwd, exe: path.join(resourcesPath, 'agent-runtime', 'python.exe'), args: ['-E', '-s', '-u', 'src/agent.py', 'start'] };
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

// What the agent printed, in words a helper understands. The first match wins.
const PLAIN_ERRORS = [
	[/failed to connect to livekit.*\b401\b/i, "That LiveKit key didn't work. Check the API key and secret."],
	[/failed to connect to livekit/i, "Can't reach LiveKit. Check the internet connection and the LiveKit URL."],
	[/API key not valid|API_KEY_INVALID/i, "That Gemini key didn't work."],
	[/did not find executable|No Python at/i, "The voice assistant's Python is missing. Run uv sync in the agent folder."],
];
const plainError = (text) => PLAIN_ERRORS.find(([pattern]) => pattern.test(text))?.[1] ?? null;

function createAgentSupervisor({
	command,
	getEnv,
	logFile,
	log = console.log,
	maxRestarts = 3,
	stableMs = 10 * 60 * 1000,
	restartDelayMs = 2000,
	onGiveUp = () => {},
	earlyExitMs = 60 * 1000,
	spawnFn = spawn,
	killFn = killTree,
	now = Date.now,
}) {
	let child = null;
	let stopping = false;
	let restarts = 0;
	let startedAt = 0;
	let timer = null;
	let logFailed = false;
	let stderrHead = '';
	// starting | ready | error | off. Settings shows it after keys are saved.
	let status = { state: 'off', message: null };

	const writeLog = (line) => {
		if (!logFile) return;
		try {
			fs.appendFileSync(logFile, line);
		} catch (error) {
			// Logging must never stop the agent, but say once that agent.log is not being written.
			if (!logFailed) log(`[VISION] Can't write the voice agent log ${logFile}: ${error.message}`);
			logFailed = true;
		}
	};

	const onOutput = (chunk, isError) => {
		writeLog(chunk);
		const text = String(chunk);
		if (isError && stderrHead.length < 2000) stderrHead += text;
		if (/registered worker/.test(text)) {
			status = { state: 'ready', message: null };
		} else if (status.state !== 'ready') {
			const message = plainError(text);
			if (message) status = { state: 'error', message };
		}
	};

	function start() {
		if (child || stopping) return false;
		if (!fs.existsSync(command.exe)) {
			log(`[VISION] Voice agent not found: ${command.exe}`);
			status = { state: 'error', message: 'The voice assistant is missing from this install.' };
			return false;
		}
		writeLog(`\n----- agent started ${new Date().toISOString()} -----\n`);
		startedAt = now();
		stderrHead = '';
		if (status.state !== 'error') status = { state: 'starting', message: null };
		const proc = spawnFn(command.exe, command.args, {
			cwd: command.cwd,
			env: { ...process.env, PYTHONUNBUFFERED: '1', ...getEnv() },
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		child = proc;
		proc.stdout?.on('data', (chunk) => onOutput(chunk, false));
		proc.stderr?.on('data', (chunk) => onOutput(chunk, true));
		proc.on('error', (error) => log(`[VISION] Voice agent failed to start: ${error.message}`));
		proc.on('exit', (code) => onExit(proc, code));
		log(`[VISION] Voice agent started (pid ${proc.pid})`);
		return true;
	}

	function onExit(proc, code) {
		if (proc !== child) return;
		child = null;
		if (stopping) return;
		if (now() - startedAt < earlyExitMs) {
			// A quick crash is usually a setup problem: put its first words where people look.
			const head = stderrHead.split(/\r?\n/).filter((line) => line.trim()).slice(0, 5).join('\n');
			if (head) log(`[VISION] Voice agent said before it stopped:\n${head}`);
			if (status.state !== 'error') status = { state: 'error', message: plainError(head) ?? 'Voice could not start. The details are in the log.' };
		}
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
		status = { state: 'off', message: null };
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
		status = { state: 'starting', message: null };
		return start();
	}

	return { start, stop, restart, isRunning: () => Boolean(child), getStatus: () => ({ ...status }) };
}

module.exports = { createAgentSupervisor, resolveAgentCommand, killTree, plainError };
