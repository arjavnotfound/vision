// Voice control of VISION end to end, without a voice session: the real app (hidden, off
// screen, silent, fake camera, logging mouse driver) gets the exact bus commands the
// assistant's set_setting tool sends, and the checks read the face window and the one
// settings file.
//
//   node scripts/qa/voice-control-e2e.js [evidence dir]

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const repoRoot = path.resolve(__dirname, "../..");
const desktopDir = path.join(repoRoot, "app");
const electronExe = path.join(desktopDir, "node_modules", "electron", "dist", "electron.exe");
const cdpPort = 9353;
const busPort = 9354;
const token = "qa-voice-control";
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-t12-"));
const userData = path.join(runDir, "userData");
const outDir = process.argv[2] ? path.resolve(process.argv[2]) : runDir;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bus(cmd, value) {
	const res = await fetch(`http://127.0.0.1:${busPort}/command`, {
		method: "POST",
		headers: { "content-type": "application/json", "x-vision-token": token },
		body: JSON.stringify(value === undefined ? { cmd } : { cmd, value }),
	});
	return res.json();
}

async function connect() {
	let page;
	for (let i = 0; i < 120 && !page; i++) {
		try {
			const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
			page = targets.find((t) => t.type === "page" && /ui\/index\.html/.test(t.url));
		} catch (_error) { /* not up yet */ }
		if (!page) await sleep(500);
	}
	if (!page) throw new Error("face window not found over CDP");
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	let id = 0;
	const pending = new Map();
	ws.onmessage = (event) => {
		const msg = JSON.parse(event.data);
		if (msg.id && pending.has(msg.id)) {
			pending.get(msg.id)(msg);
			pending.delete(msg.id);
		}
	};
	await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
	const call = async (method, params) => {
		const myId = ++id;
		ws.send(JSON.stringify({ id: myId, method, params }));
		return new Promise((resolve) => pending.set(myId, resolve));
	};
	const evaluate = async (expression) => {
		const msg = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
		if (msg.result?.exceptionDetails) throw new Error(msg.result.exceptionDetails.exception?.description || "evaluate failed");
		return msg.result?.result?.value;
	};
	const screenshot = async (file) => {
		const msg = await call("Page.captureScreenshot", { format: "png" });
		fs.writeFileSync(file, Buffer.from(msg.result.data, "base64"));
	};
	return { evaluate, screenshot, close: () => ws.close() };
}

const results = [];
function record(name, pass, evidence) {
	results.push({ name, pass });
	console.log(`${pass ? "PASS" : "FAIL"}  ${name}${evidence ? `  - ${evidence}` : ""}`);
}

async function waitFor(fn, timeoutMs) {
	const end = Date.now() + timeoutMs;
	while (Date.now() < end) {
		const value = await fn().catch(() => null);
		if (value) return value;
		await sleep(200);
	}
	return null;
}

const savedSettings = () => {
	try {
		return JSON.parse(fs.readFileSync(path.join(userData, "vision-settings.json"), "utf8")).globalSettings ?? {};
	} catch (_error) {
		return {};
	}
};

(async () => {
	fs.mkdirSync(outDir, { recursive: true });
	const logFd = fs.openSync(path.join(runDir, "main.log"), "w");
	const child = spawn(electronExe, [".", "--synthetic-face"], {
		cwd: desktopDir,
		env: {
			...process.env,
			VISION_FAKE_INPUT: path.join(runDir, "driver.log"),
			VISION_USER_DATA_DIR: userData,
			VISION_REMOTE_DEBUG_PORT: String(cdpPort),
			VISION_BUS_PORT: String(busPort),
			VISION_BUS_TOKEN: token,
			VISION_QA_SILENT: "1",
			VISION_QA_FAKE_CAMERA: "1",
			VISION_QA_OFFSCREEN: "1",
			VISION_QA_HEADLESS_BROWSER: "1",
		},
		stdio: ["ignore", logFd, logFd],
	});
	const cdp = await connect();
	const ev = cdp.evaluate;
	try {
		await waitFor(() => ev("window.__visionReady === true"), 30000);
		await ev(`[...document.querySelectorAll("button")].find((x) => x.textContent === "Skip setup")?.click(); true`);
		await waitFor(() => bus("status").then((r) => r.ok), 15000);
		const st = (key) => ev(`window.visionEngine.settings.get(${JSON.stringify(key)})`);

		const before = await st("headTrackingSensitivityX");
		const slower = await bus("set-setting", { name: "cursor_speed", value: "slower" });
		const after = await st("headTrackingSensitivityX");
		record("slower cursor lowers the Settings sensitivity", slower.done === "cursor speed 4" && after < before, `${before} -> ${after}, ${slower.done}`);

		const dwell = await bus("set-setting", { name: "dwell_time", value: "1.2" });
		await sleep(600);
		record("dwell time 1.2 s reaches the face window and the settings file", (await st("dwellTime")) === 1200 && savedSettings().dwellTime === 1200, `${dwell.done}, file ${savedSettings().dwellTime}`);

		const badDwell = await bus("set-setting", { name: "dwell_time", value: "5" });
		record("dwell time 5 s is refused in plain words", Boolean(badDwell.error) && (await st("dwellTime")) === 1200, badDwell.error);

		const volume = await bus("set-setting", { name: "volume", value: "60" });
		record("volume 60 is saved in the one settings file", savedSettings().voiceVolume === 60, `${volume.done}`);
		const badVolume = await bus("set-setting", { name: "volume", value: "0" });
		record("volume 0 is refused", Boolean(badVolume.error) && savedSettings().voiceVolume === 60, badVolume.error);

		await bus("pause");
		const paused = await ev("window.visionEngine.isPaused()");
		await bus("set-setting", { name: "face_control", value: "on" });
		const resumed = !(await ev("window.visionEngine.isPaused()"));
		record("pause, then face control on, resumes", paused && resumed);

		const unknown = await bus("set-setting", { name: "clickingMode", value: "off" });
		record("a setting outside the whitelist is refused", Boolean(unknown.error) && (await st("clickingMode")) !== "off", unknown.error);

		await ev(`document.getElementById("settings-btn").click(); true`);
		await sleep(800);
		await cdp.screenshot(path.join(outDir, "t12-setting-change-pointer.png"));
		await ev(`[...document.querySelectorAll(".sheet__body button, [role=tab], button")].find((x) => x.textContent.trim() === "Clicking")?.click(); true`);
		await sleep(500);
		await cdp.screenshot(path.join(outDir, "t12-setting-change-dwell.png"));
	} catch (error) {
		record("run", false, String(error?.message ?? error));
	} finally {
		cdp.close();
		child.kill();
	}
	const passed = results.filter((r) => r.pass).length;
	console.log(`${passed}/${results.length} passed. Log: ${runDir}`);
	process.exitCode = passed === results.length ? 0 : 1;
})();
