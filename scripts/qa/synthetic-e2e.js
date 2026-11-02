// End-to-end QA of gestures and failsafes WITHOUT a person and WITHOUT touching the real mouse.
//
//   node scripts/qa/synthetic-e2e.js
//
// Launches the real desktop app (real camera, real engine, real main process, real mouse
// safety) with two QA switches:
//   --synthetic-face        face-mesh output replaced by a scripted synthetic face
//   VISION_FAKE_INPUT=log   native mouse driver replaced by a logger (no OS input at all)
// Then drives gestures over CDP and checks what reaches the "driver".
// The only real OS input is the F9 key (pressed twice) to test the global hotkey.

const { spawn, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const repoRoot = path.resolve(__dirname, "../..");
const desktopDir = path.join(repoRoot, "app");
const electronExe = path.join(desktopDir, "node_modules", "electron", "dist", "electron.exe");
const port = 9351;
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-qa-"));
const driverLog = path.join(runDir, "driver.log");
const mainLog = path.join(runDir, "main.log");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readDriver() {
	if (!fs.existsSync(driverLog)) return [];
	return fs.readFileSync(driverLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function pressF9() {
	const koffi = require(path.join(desktopDir, "node_modules", "koffi"));
	const user32 = koffi.load("user32.dll");
	const keybd_event = user32.func("void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)");
	keybd_event(0x78, 0, 0, 0);
	keybd_event(0x78, 0, 2, 0);
}

async function connect() {
	let page;
	for (let i = 0; i < 120 && !page; i++) {
		try {
			const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
			page = targets.find((t) => t.type === "page" && /ui\/index\.html/.test(t.url));
		} catch (_error) { /* not up yet */ }
		if (!page) await sleep(500);
	}
	if (!page) throw new Error("app window not found over CDP");
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
	const evaluate = async (expression) => {
		const myId = ++id;
		ws.send(JSON.stringify({ id: myId, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
		const msg = await new Promise((resolve) => pending.set(myId, resolve));
		if (msg.result?.exceptionDetails) throw new Error(msg.result.exceptionDetails.exception?.description || "evaluate failed");
		return msg.result?.result?.value;
	};
	return { evaluate, close: () => ws.close() };
}

const results = [];
function record(name, pass, evidence) {
	results.push({ name, pass, evidence });
	console.log(`${pass ? "PASS" : "FAIL"}  ${name}${evidence ? `  — ${evidence}` : ""}`);
}

async function waitFor(fn, timeoutMs, stepMs = 100) {
	const end = Date.now() + timeoutMs;
	while (Date.now() < end) {
		const value = await fn();
		if (value) return value;
		await sleep(stepMs);
	}
	return null;
}

(async () => {
	const logFd = fs.openSync(mainLog, "w");
	const child = spawn(electronExe, [".", "--synthetic-face"], {
		cwd: desktopDir,
		env: { ...process.env, VISION_FAKE_INPUT: driverLog, VISION_USER_DATA_DIR: path.join(runDir, "userData"), VISION_REMOTE_DEBUG_PORT: String(port), VISION_NO_ASSISTANT: "1" },
		stdio: ["ignore", logFd, logFd],
	});
	let exited = false;
	child.on("exit", () => { exited = true; });
	const cdp = await connect();
	const ev = cdp.evaluate;
	const setFace = (face) => ev(`globalThis.__syntheticFaceOverride = ${JSON.stringify(face)}; true`);
	const NEUTRAL = { leftEye: 0.3, rightEye: 0.3, mouth: 0.05, brow: 0.22, pitch: 0 };
	const set = (key, value) => ev(`window.visionEngine.settings.set(${JSON.stringify(key)}, ${JSON.stringify(value)}); true`);
	const ops = (since, op, button) => readDriver().filter((e) => e.t >= since && e.op === op && (!button || e.button === button));
	const mainSays = (text) => fs.readFileSync(mainLog, "utf8").includes(text);

	try {
		await waitFor(() => ev("Boolean(window.visionEngine)"), 30000);
		await setFace(NEUTRAL);
		await waitFor(() => ev("window.visionEngine.getState().faceFound"), 30000);
		await ev(`window.__qa = []; for (const type of ["gesture", "click"]) window.visionEngine.on(type, (e) => window.__qa.push({ type, ...e })); true`);
		await set("clickingMode", "blink");
		await set("closeEyesToToggle", false);
		await set("delayBeforeDragging", 0);
		await ev("window.visionEngine.setPaused(false); true");
		await sleep(1500);
		const fps = await ev("window.visionEngine.getState().fps");
		const status = await ev("window.visionEngine.getState().status");
		const camera = await ev("JSON.stringify(window.visionEngine.getState().camera?.error ?? null)");
		record("engine tracking with synthetic face", status === "tracking", `status ${status}, camera error ${camera}, loop ${fps} FPS`);

		// 1. Left wink -> left click
		let t = Date.now();
		await setFace({ ...NEUTRAL, leftEye: 0.05 });
		await sleep(700);
		await setFace(NEUTRAL);
		await sleep(700);
		record("left wink fires LEFT CLICK", ops(t, "down", "left").length >= 1 && ops(t, "up", "left").length >= 1,
			`driver: ${ops(t, "down", "left").length} down / ${ops(t, "up", "left").length} up (left)`);

		// 2. Right wink -> right click
		t = Date.now();
		await setFace({ ...NEUTRAL, rightEye: 0.05 });
		await sleep(700);
		await setFace(NEUTRAL);
		await sleep(700);
		record("right wink fires RIGHT CLICK", ops(t, "down", "right").length >= 1 && ops(t, "up", "right").length >= 1,
			`driver: ${ops(t, "down", "right").length} down / ${ops(t, "up", "right").length} up (right)`);

		// 3. Brow raise -> gesture event (short, so the keyboard does not open)
		await ev("window.__qa.length = 0; true");
		await setFace({ ...NEUTRAL, brow: 0.34 });
		await sleep(800);
		await setFace(NEUTRAL);
		await sleep(300);
		const browEvents = await ev(`window.__qa.filter((e) => e.type === "gesture" && e.gesture === "brow").length`);
		record("brow raise detected", browEvents >= 1, `${browEvents} brow gesture event(s)`);

		// 4. Mouth open + head tilted up -> scroll up (blink mode)
		t = Date.now();
		await setFace({ ...NEUTRAL, mouth: 0.5, pitch: 12 });
		await sleep(900);
		await setFace(NEUTRAL);
		await sleep(400);
		const scrolls = readDriver().filter((e) => e.t >= t && e.op === "key");
		record("mouth open + tilt up scrolls up", scrolls.length > 0 && scrolls.every((e) => e.key === "up"), `${scrolls.length} scroll steps (${[...new Set(scrolls.map((e) => e.key))].join(",")})`);

		// 5. Mouth click (open-mouth-simple)
		await set("clickingMode", "open-mouth-simple");
		t = Date.now();
		await setFace({ ...NEUTRAL, mouth: 0.5 });
		await sleep(900);
		await setFace(NEUTRAL);
		await sleep(600);
		record("open mouth fires LEFT CLICK / hold", ops(t, "down", "left").length >= 1 && ops(t, "up", "left").length >= 1,
			`driver: ${ops(t, "down", "left").length} down / ${ops(t, "up", "left").length} up`);

		// 6. Sleep gesture toggles pause (when enabled)
		await set("closeEyesToToggle", true);
		await setFace({ ...NEUTRAL, leftEye: 0.05, rightEye: 0.05 });
		const pausedBySleep = await waitFor(() => ev("window.visionEngine.isPaused()"), 4000);
		await setFace(NEUTRAL);
		await sleep(600);
		await setFace({ ...NEUTRAL, leftEye: 0.05, rightEye: 0.05 });
		const resumedBySleep = await waitFor(async () => !(await ev("window.visionEngine.isPaused()")), 4000);
		await setFace(NEUTRAL);
		await set("closeEyesToToggle", false);
		await sleep(500);
		record("close eyes 2 s pauses and resumes", Boolean(pausedBySleep && resumedBySleep), `paused ${Boolean(pausedBySleep)}, resumed ${Boolean(resumedBySleep)}`);

		// 7. F9 (real global hotkey) while a gesture holds the button -> released
		t = Date.now();
		await setFace({ ...NEUTRAL, mouth: 0.5 });
		const heldBeforeF9 = await waitFor(() => ops(t, "down", "left").length > 0, 2000);
		const tF9 = Date.now();
		pressF9();
		const releasedByF9 = await waitFor(() => ops(tF9, "up", "left").length > 0, 1500);
		const pausedByF9 = await ev("window.visionEngine.isPaused()");
		record("F9 pauses and releases a held gesture click", Boolean(heldBeforeF9 && releasedByF9 && pausedByF9),
			`held ${Boolean(heldBeforeF9)}, released in ${releasedByF9 ? (ops(tF9, "up", "left")[0].t - tF9) + " ms" : "never"}, paused ${pausedByF9}`);
		await setFace(NEUTRAL);
		await sleep(300);
		pressF9();
		const resumedByF9 = await waitFor(async () => !(await ev("window.visionEngine.isPaused()")), 2000);
		record("F9 resumes", Boolean(resumedByF9), "");
		await sleep(800);

		// 8. Physical mouse takeover while holding -> released
		t = Date.now();
		await setFace({ ...NEUTRAL, mouth: 0.5 });
		const heldBeforeTakeover = await waitFor(() => ops(t, "down", "left").length > 0, 2000);
		const tMove = Date.now();
		await ev(`window.electronAPI.qa({ type: "physical-move", dx: 80, dy: 0 })`);
		const releasedByTakeover = await waitFor(() => ops(tMove, "up", "left").length > 0, 1500);
		record("physical mouse takeover releases a held button", Boolean(heldBeforeTakeover && releasedByTakeover && mainSays("manual-takeover")),
			`released in ${releasedByTakeover ? (ops(tMove, "up", "left")[0].t - tMove) + " ms" : "never"}; main log: ${mainSays("manual-takeover") ? "manual-takeover release" : "-"}`);
		await setFace(NEUTRAL);
		await sleep(2800); // takeover lasts 2 s after the mouse stops

		// 9. Dwell click on the desktop overlay
		await set("clickingMode", "dwell");
		t = Date.now();
		const dwellClick = await waitFor(() => readDriver().some((e) => e.t >= t && e.op === "down" && e.via === "click"), 8000);
		record("dwell click on the desktop", Boolean(dwellClick), dwellClick ? `clicked after ${readDriver().find((e) => e.t >= t && e.via === "click").t - t} ms` : "no click");

		// 10. Dwell drag: first dwell presses, next dwell releases
		await set("dwellDrag", true);
		await sleep(400);
		t = Date.now();
		const dragDown = await waitFor(() => ops(t, "down", "left").find((e) => !e.via), 8000);
		const dragUp = dragDown ? await waitFor(() => ops(dragDown.t + 1, "up", "left").find((e) => !e.via), 8000) : null;
		record("dwell drag: grab then drop", Boolean(dragDown && dragUp), dragDown ? `down, then up after ${dragUp ? dragUp.t - dragDown.t : "?"} ms` : "no press");
		await set("dwellDrag", false);
		await set("clickingMode", "open-mouth-simple");
		await sleep(1500);

		// 11. Quit while a gesture holds the button -> released on the way out
		t = Date.now();
		await setFace({ ...NEUTRAL, mouth: 0.5 });
		const heldBeforeQuit = await waitFor(() => ops(t, "down", "left").length > 0, 2000);
		const tQuit = Date.now();
		ev(`window.electronAPI.windowControl("quit")`).catch(() => { });
		await waitFor(() => exited, 10000);
		const upAfterQuit = ops(tQuit, "up", "left");
		record("quitting releases a held button", Boolean(heldBeforeQuit && exited && upAfterQuit.length > 0),
			`held ${Boolean(heldBeforeQuit)}, exited ${exited}, releases logged: ${upAfterQuit.length}`);
	} catch (error) {
		record("harness", false, error.message);
	} finally {
		cdp.close();
		if (!exited) {
			try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch (_error) { /* ignore */ }
		}
		const summary = { date: new Date().toISOString(), passed: results.filter((r) => r.pass).length, total: results.length, results, runDir };
		fs.writeFileSync(path.join(__dirname, "last-run.json"), JSON.stringify(summary, null, 2));
		console.log(`\n${summary.passed}/${summary.total} passed. Logs: ${runDir}`);
		process.exitCode = summary.passed === summary.total ? 0 : 1;
	}
})();
