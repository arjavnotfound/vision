// Benchmark harness for the VISION desktop app.
//
// Launches the real app (real camera, tracking left PAUSED so the cursor is never moved),
// reads the engine loop FPS over the Chrome DevTools Protocol, and samples total CPU
// time of the whole Electron process tree.
//
// Usage: node scripts/bench/measure.js [--warmup 20] [--seconds 30] [--label baseline] [-- extra electron args]
//
// Windows only (CPU sampling uses CIM). Results are printed as JSON and appended to
// scripts/bench/results.jsonl.

const { spawn, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const argv = process.argv.slice(2);
const dashIndex = argv.indexOf("--");
const ownArgs = dashIndex === -1 ? argv : argv.slice(0, dashIndex);
const extraElectronArgs = dashIndex === -1 ? [] : argv.slice(dashIndex + 1);
const getArg = (name, fallback) => {
	const i = ownArgs.indexOf(`--${name}`);
	return i === -1 ? fallback : ownArgs[i + 1];
};

const warmupSeconds = Number(getArg("warmup", 20));
const sampleSeconds = Number(getArg("seconds", 30));
const label = getArg("label", "run");
const port = Number(getArg("port", 9339));

const repoRoot = path.resolve(__dirname, "../..");
const desktopDir = path.join(repoRoot, "app");
const electronExe = path.join(desktopDir, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function processTreeCpuSeconds(rootPid) {
	// Sum user+kernel time for rootPid and all descendants.
	const script = `
$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,UserModeTime,KernelModeTime
$ids = New-Object System.Collections.Generic.HashSet[int]
[void]$ids.Add(${rootPid})
$changed = $true
while ($changed) { $changed = $false; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { [void]$ids.Add([int]$p.ProcessId); $changed = $true } } }
$sum = 0; $count = 0
foreach ($p in $all) { if ($ids.Contains([int]$p.ProcessId)) { $sum += [double]$p.UserModeTime + [double]$p.KernelModeTime; $count++ } }
Write-Output "$sum $count"`;
	const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim();
	const [sum, count] = out.split(/\s+/).map(Number);
	return { cpuSeconds: sum / 1e7, processCount: count };
}

async function getPageTarget() {
	for (let i = 0; i < 120; i++) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json`);
			const targets = await res.json();
			const page = targets.find((t) => t.type === "page" && /(electron-app|ui\/index)\.html/.test(t.url));
			if (page) return page;
		} catch (_error) {
			// not up yet
		}
		await sleep(500);
	}
	throw new Error("Timed out waiting for the app window over CDP");
}

function cdp(wsUrl) {
	const ws = new WebSocket(wsUrl);
	let nextId = 1;
	const pending = new Map();
	const events = [];
	ws.onmessage = (event) => {
		const msg = JSON.parse(event.data);
		if (msg.method === "Runtime.exceptionThrown") {
			events.push({ type: "exception", text: msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text });
		} else if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "warning")) {
			events.push({ type: msg.params.type, text: msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300) });
		}
		if (msg.id && pending.has(msg.id)) {
			pending.get(msg.id)(msg);
			pending.delete(msg.id);
		}
	};
	const ready = new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = reject;
	});
	return {
		ready,
		events,
		async evaluate(expression) {
			const id = nextId++;
			ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
			const msg = await new Promise((resolve) => pending.set(id, resolve));
			return msg.result?.result?.value;
		},
		async send(method, params = {}) {
			const id = nextId++;
			ws.send(JSON.stringify({ id, method, params }));
			const msg = await new Promise((resolve) => pending.set(id, resolve));
			return msg.result;
		},
		close() { ws.close(); },
	};
}

// Works for both the legacy UI (reads its telemetry DOM) and the new engine API.
const PROBE = `(() => {
	const engine = window.visionEngine;
	if (engine && engine.getState) {
		const s = engine.getState();
		return { fps: s.fps, faceFound: s.faceFound, facemeshHz: s.facemeshHz ?? null, ui: "new" };
	}
	const fpsText = document.querySelector('#telemetry-fps')?.textContent;
	const word = document.querySelector('#active-action-word')?.textContent || "";
	// While paused the status word is "STANDBY", so use the tracked point count as the face signal.
	const points = parseInt(document.querySelector('#telemetry-points')?.textContent || "0", 10);
	return { fps: parseFloat(fpsText), points, faceFound: points > 0, word, ui: "legacy" };
})()`;

(async () => {
	if (!fs.existsSync(electronExe)) {
		throw new Error(`Electron not found at ${electronExe}. Run npm install in app.`);
	}
	const logPath = getArg("log", null);
	const logFd = logPath ? fs.openSync(logPath, "w") : "ignore";
	const child = spawn(electronExe, [".", ...extraElectronArgs], {
		cwd: desktopDir,
		env: { ...process.env, VISION_REMOTE_DEBUG_PORT: String(port) },
		stdio: ["ignore", logFd, logFd],
	});
	let exited = false;
	child.on("exit", () => { exited = true; });

	try {
		const page = await getPageTarget();
		const client = cdp(page.webSocketDebuggerUrl);
		await client.ready;
		await client.send("Runtime.enable");
		console.error(`[bench] connected; warming up ${warmupSeconds}s`);
		await sleep(warmupSeconds * 1000);

		const cpu0 = processTreeCpuSeconds(child.pid);
		const t0 = Date.now();
		const samples = [];
		while (Date.now() - t0 < sampleSeconds * 1000) {
			samples.push(await client.evaluate(PROBE));
			await sleep(1000);
		}
		const cpu1 = processTreeCpuSeconds(child.pid);
		const wall = (Date.now() - t0) / 1000;
		const screenshotPath = getArg("screenshot", null);
		if (screenshotPath) {
			const shot = await client.send("Page.captureScreenshot", { format: "png" });
			fs.writeFileSync(screenshotPath, Buffer.from(shot.data, "base64"));
		}

		const fpsValues = samples.map((s) => s?.fps).filter((v) => Number.isFinite(v));
		const mean = fpsValues.reduce((a, b) => a + b, 0) / Math.max(1, fpsValues.length);
		const min = Math.min(...fpsValues);
		const faceFrames = samples.filter((s) => s?.faceFound === true).length;
		const hzValues = samples.map((s) => s?.facemeshHz).filter((v) => Number.isFinite(v));
		const result = {
			label,
			date: new Date().toISOString(),
			ui: samples[0]?.ui,
			sampleSeconds: wall,
			fpsMean: Number(mean.toFixed(1)),
			fpsMin: Number(min.toFixed(1)),
			facemeshHzMean: hzValues.length ? Number((hzValues.reduce((a, b) => a + b, 0) / hzValues.length).toFixed(1)) : null,
			faceVisibleFraction: Number((faceFrames / Math.max(1, samples.length)).toFixed(2)),
			cpuPercentOfOneCore: Number(((cpu1.cpuSeconds - cpu0.cpuSeconds) / wall * 100).toFixed(1)),
			cpuPercentOfMachine: Number(((cpu1.cpuSeconds - cpu0.cpuSeconds) / wall / os.cpus().length * 100).toFixed(1)),
			processCount: cpu1.processCount,
			cores: os.cpus().length,
			rendererErrors: client.events.slice(0, 20),
		};
		client.close();
		console.log(JSON.stringify(result, null, 2));
		fs.appendFileSync(path.join(__dirname, "results.jsonl"), JSON.stringify(result) + "\n");
	} finally {
		if (!exited) {
			// Graceful close first (lets the app release any held buttons), then force.
			try { execFileSync("taskkill", ["/PID", String(child.pid), "/T"], { stdio: "ignore" }); } catch (_error) { /* ignore */ }
			await sleep(3000);
			if (!exited) {
				try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch (_error) { /* ignore */ }
			}
		}
	}
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
