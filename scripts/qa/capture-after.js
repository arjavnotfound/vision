// Screenshots of the real VISION window's main screens, hidden (off-screen window, CDP capture).
//   node scripts/qa/capture-after.js [dir] [--real-face]   (default vision-dev/evidence/UX/after)
// --real-face: the webcam and real face mesh instead of the synthetic face.
// Fresh profile, synthetic face, no assistant, silent; the real mouse is never touched.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const repoRoot = path.resolve(__dirname, "../..");
const desktopDir = path.join(repoRoot, "app");
const electronExe = path.join(desktopDir, "node_modules", "electron", "dist", "electron.exe");
const out = path.resolve(process.argv[2] || path.join(repoRoot, "vision-dev/evidence/UX/after"));
const port = 9352;
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-shots-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
	let page;
	for (let i = 0; i < 120 && !page; i++) {
		try {
			page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page" && /ui\/index\.html/.test(t.url));
		} catch (_error) { /* not up yet */ }
		if (!page) await sleep(500);
	}
	if (!page) throw new Error("app window not found over CDP");
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	let id = 0;
	const pending = new Map();
	ws.onmessage = (event) => {
		const msg = JSON.parse(event.data);
		if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
	};
	await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
	const send = (method, params) => new Promise((resolve) => { const myId = ++id; pending.set(myId, resolve); ws.send(JSON.stringify({ id: myId, method, params })); });
	const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
	const shot = async (name) => {
		const msg = await send("Page.captureScreenshot", { format: "png" });
		fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(msg.result.data, "base64"));
		console.log("saved", name);
	};
	return { ev, shot, close: () => ws.close() };
}

(async () => {
	fs.mkdirSync(out, { recursive: true });
	const child = spawn(electronExe, process.argv.includes("--real-face") ? ["."] : [".", "--synthetic-face"], {
		cwd: desktopDir,
		env: { ...process.env, VISION_USER_DATA_DIR: path.join(runDir, "userData"), VISION_REMOTE_DEBUG_PORT: String(port), VISION_NO_ASSISTANT: "1", VISION_QA_SILENT: "1", VISION_QA_OFFSCREEN: "1", VISION_FAKE_INPUT: path.join(runDir, "driver.log") },
		stdio: "ignore",
	});
	const { ev, shot, close } = await connect();
	const click = (text) => ev(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))?.click(); true`);
	try {
		for (let i = 0; i < 60 && !(await ev("window.__visionReady === true")); i++) await sleep(500);
		await ev("globalThis.__syntheticFaceOverride = { leftEye: 0.3, rightEye: 0.3, mouth: 0.05, brow: 0.22, pitch: 0 }; true");
		await sleep(2500);
		await shot("first-run");
		await click("Skip setup");
		await sleep(1500);
		for (const page of ["home", "face", "voice", "settings", "help"]) {
			await ev(`document.querySelector('[data-page="${page}"]')?.click(); true`);
			await sleep(1200);
			await shot(page);
		}
		await ev(`document.querySelector('[data-page="help"]')?.click(); true`);
		await sleep(800);
		await click("Diagnostics");
		await sleep(2000);
		await shot("diagnostics");
		await ev(`document.querySelector('[data-page="face"]')?.click(); true`);
		await sleep(800);
		await click("Calibrate");
		await sleep(2500);
		await shot("calibration");
	} finally {
		close();
		child.kill();
	}
})().catch((e) => { console.error(e); process.exit(1); });
