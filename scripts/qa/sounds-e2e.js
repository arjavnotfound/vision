// Voice cue sounds end to end, silently: the real app (hidden, off screen, island audio
// muted by VISION_QA_SILENT, fake camera, logging mouse driver). Checks that the four files
// decode in the island, that Talk plays the wake cue at the Settings volume, that the
// Settings switch turns the cues off, and captures Settings > Voice.
//
//   node scripts/qa/sounds-e2e.js [evidence dir]

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const repoRoot = path.resolve(__dirname, "../..");
const desktopDir = path.join(repoRoot, "app");
const electronExe = path.join(desktopDir, "node_modules", "electron", "dist", "electron.exe");
const cdpPort = 9363;
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-t09-"));
const userData = path.join(runDir, "userData");
const logFile = path.join(runDir, "main.log");
const outDir = process.argv[2] ? path.resolve(process.argv[2]) : runDir;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(match) {
	let page;
	for (let i = 0; i < 120 && !page; i++) {
		try {
			const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
			page = targets.find((t) => t.type === "page" && match.test(t.url));
		} catch (_error) { /* not up yet */ }
		if (!page) await sleep(500);
	}
	if (!page) throw new Error(`no page matching ${match} over CDP`);
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
	const call = (method, params) => {
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

const soundLines = () => fs.readFileSync(logFile, "utf8").split(/\r?\n/).filter((l) => l.includes("[VISION] sound "));
const clickByLabel = (label) => `(() => { const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === ${JSON.stringify(label)} || x.textContent.trim() === ${JSON.stringify(label)}); b?.click(); return Boolean(b); })()`;

(async () => {
	fs.mkdirSync(outDir, { recursive: true });
	const logFd = fs.openSync(logFile, "w");
	const child = spawn(electronExe, [".", "--synthetic-face"], {
		cwd: desktopDir,
		env: {
			...process.env,
			VISION_FAKE_INPUT: path.join(runDir, "driver.log"),
			VISION_USER_DATA_DIR: userData,
			VISION_REMOTE_DEBUG_PORT: String(cdpPort),
			VISION_QA_SILENT: "1",
			VISION_QA_FAKE_CAMERA: "1",
			VISION_QA_OFFSCREEN: "1",
			VISION_QA_HEADLESS_BROWSER: "1",
		},
		stdio: ["ignore", logFd, logFd],
	});
	let face = null;
	let island = null;
	try {
		face = await connect(/ui\/index\.html/);
		island = await connect(/^app:\/\/console\//);
		await waitFor(() => face.evaluate("window.__visionReady === true"), 30000);
		await face.evaluate(clickByLabel("Skip setup"));

		const files = await island.evaluate(`Promise.all(["wake", "listening", "done", "error"].map(async (n) => {
			const ctx = new OfflineAudioContext(1, 48000, 48000);
			const b = await ctx.decodeAudioData(await (await fetch("/sounds/" + n + ".ogg")).arrayBuffer());
			return n + " " + Math.round(b.duration * 1000) + " ms";
		}))`);
		const ms = files.map((f) => Number(f.split(" ")[1]));
		record("four cue files decode in the island, 60-400 ms each", ms.length === 4 && ms.every((m) => m >= 60 && m <= 400), files.join(", "));

		const talk = async () => {
			await waitFor(() => island.evaluate(clickByLabel("VISION menu")), 15000);
			await sleep(400);
			return island.evaluate(`${clickByLabel("Talk")} || ${clickByLabel("Voice is off")}`);
		};
		const before = soundLines().length;
		const opened = await talk();
		const wake = await waitFor(async () => soundLines().slice(before).find((l) => l.includes("sound wake")), 8000);
		record("Talk plays the wake cue at the default volume 60", opened && /sound wake volume 60/.test(wake ?? ""), wake ?? "no wake line");
		await sleep(3000);
		const afterWake = soundLines().slice(before).map((l) => l.replace(/^.*\[VISION\] /, "")).join(" | ");
		console.log(`      cues after Talk: ${afterWake}`);

		await face.evaluate(`window.electronAPI.setOptions({ globalSettings: { soundsOn: false, soundVolume: 30 } }); true`);
		await sleep(800);
		const mark = soundLines().length;
		await island.evaluate(clickByLabel("Stop")).catch(() => false);
		await sleep(600);
		await talk();
		const off = await waitFor(async () => soundLines().slice(mark).find((l) => l.includes("sound wake")), 8000);
		record("sounds off in Settings: the wake cue is skipped", /sound wake off/.test(off ?? ""), off ?? "no wake line");

		await face.evaluate(`window.electronAPI.setOptions({ globalSettings: { soundsOn: true, soundVolume: 60 } }); true`);
		await face.evaluate(`document.getElementById("settings-btn").click(); true`);
		await sleep(800);
		await face.evaluate(clickByLabel("Voice"));
		const section = await waitFor(() => face.evaluate(`[...document.querySelectorAll(".sheet__section .label")].some((x) => x.textContent === "SOUNDS") && [...document.querySelectorAll(".toggle__name")].some((x) => x.textContent === "Sounds")`), 8000);
		record("Settings > Voice shows the sounds switch and volume", Boolean(section));
		await face.evaluate(`[...document.querySelectorAll(".sheet__section .label")].find((x) => x.textContent === "SOUNDS")?.scrollIntoView(); true`);
		await sleep(300);
		await face.screenshot(path.join(outDir, "t09-settings-voice-sounds.png"));
		await face.evaluate(clickByLabel("About"));
		await sleep(500);
		const credit = await face.evaluate(`document.querySelector(".credits")?.textContent ?? ""`);
		record("About credits the sounds", /Kenney/.test(credit), credit.slice(0, 120));
		await face.screenshot(path.join(outDir, "t09-about-credits.png"));
	} catch (error) {
		record("run", false, String(error?.message ?? error));
	} finally {
		face?.close();
		island?.close();
		child.kill();
	}
	const passed = results.filter((r) => r.pass).length;
	console.log(`${passed}/${results.length} passed. Log: ${runDir}`);
	process.exitCode = passed === results.length ? 0 : 1;
})();
