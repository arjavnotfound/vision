// The voice agent supervisor: restarts, give-up, clean stop (no real processes).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { createAgentSupervisor, resolveAgentCommand } = require('../app/src/electron-main/agent-supervisor');

function harness({ maxRestarts = 3, stableMs = 1000 } = {}) {
	let clock = 0;
	const spawned = [];
	const logs = [];
	const killed = [];
	let gaveUp = 0;
	const sup = createAgentSupervisor({
		command: { exe: process.execPath, args: [], cwd: '.' },
		getEnv: () => ({ GOOGLE_API_KEY: 'k' }),
		log: (line) => logs.push(line),
		maxRestarts,
		stableMs,
		restartDelayMs: 0,
		onGiveUp: () => gaveUp++,
		spawnFn: (_exe, _args, options) => {
			const proc = new EventEmitter();
			proc.pid = 100 + spawned.length;
			proc.options = options;
			proc.stdout = new EventEmitter();
			proc.stderr = new EventEmitter();
			spawned.push(proc);
			return proc;
		},
		killFn: (pid) => killed.push(pid),
		now: () => clock,
	});
	return { sup, spawned, logs, killed, gaveUp: () => gaveUp, tick: (ms) => { clock += ms; } };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('agent supervisor', () => {
	it('reports ready once the worker registers with LiveKit', () => {
		const h = harness();
		h.sup.start();
		assert.equal(h.sup.getStatus().state, 'starting');
		h.spawned[0].stdout.emit('data', '{"message": "registered worker", "id": "AW_x"}\n');
		assert.equal(h.sup.getStatus().state, 'ready');
	});
	it('turns a rejected LiveKit key into a plain error', () => {
		const h = harness();
		h.sup.start();
		h.spawned[0].stdout.emit('data', '{"message": "failed to connect to livekit, retrying in 0s", "error": "401, message=\'Invalid response status\'"}\n');
		assert.deepEqual(h.sup.getStatus(), { state: 'error', message: "That LiveKit key didn't work. Check the API key and secret." });
	});
	it('logs the first stderr lines when the agent exits early', async () => {
		const h = harness();
		h.sup.start();
		h.spawned[0].stderr.emit('data', "did not find executable at 'C:\\uv\\python.exe'\r\n");
		h.spawned[0].emit('exit', 103);
		await flush();
		assert.ok(h.logs.some((line) => line.includes('said before it stopped') && line.includes('did not find executable')));
		assert.match(h.sup.getStatus().message, /Python is missing/);
	});
	it('passes the keys to the agent as environment variables', () => {
		const h = harness();
		h.sup.start();
		assert.equal(h.spawned[0].options.env.GOOGLE_API_KEY, 'k');
		assert.equal(h.spawned[0].options.windowsHide, true);
	});
	it('restarts after any exit, including code 0', async () => {
		const h = harness();
		h.sup.start();
		h.spawned[0].emit('exit', 0);
		await flush();
		assert.equal(h.spawned.length, 2);
	});
	it('gives up after the restart budget', async () => {
		const h = harness({ maxRestarts: 2 });
		h.sup.start();
		for (let i = 0; i < 3; i++) {
			h.spawned.at(-1).emit('exit', 1);
			await flush();
		}
		assert.equal(h.spawned.length, 3);
		assert.equal(h.gaveUp(), 1);
		assert.equal(h.sup.isRunning(), false);
	});
	it('a long healthy run resets the budget', async () => {
		const h = harness({ maxRestarts: 1, stableMs: 1000 });
		h.sup.start();
		h.spawned[0].emit('exit', 1);
		await flush();
		h.tick(5000);
		h.spawned[1].emit('exit', 1);
		await flush();
		assert.equal(h.spawned.length, 3);
		assert.equal(h.gaveUp(), 0);
	});
	it('stop kills the started process and never restarts it', async () => {
		const h = harness();
		h.sup.start();
		h.sup.stop();
		assert.deepEqual(h.killed, [100]);
		h.spawned[0].emit('exit', 1);
		await flush();
		assert.equal(h.spawned.length, 1);
	});
	it('finds the dev venv and the bundled runtime', () => {
		const dev = resolveAgentCommand({ isPackaged: false, appPath: path.join('C:', 'v', 'app'), resourcesPath: '' });
		assert.equal(dev.exe, path.join('C:', 'v', 'agent', '.venv', 'Scripts', 'python.exe'));
		const prod = resolveAgentCommand({ isPackaged: true, appPath: '', resourcesPath: path.join('C:', 'r') });
		assert.equal(prod.exe, path.join('C:', 'r', 'agent-runtime', 'python.exe'));
		assert.deepEqual(prod.args.slice(0, 3), ['-E', '-s', '-u']);
	});
});
