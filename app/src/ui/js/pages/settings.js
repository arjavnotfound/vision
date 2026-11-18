// Settings (UX spec 3): four sections, one screen each, no scrolling at 1280x720.
// Each row: name, one plain sentence, control. "Reset to recommended" at the bottom asks once.

import { h } from "../dom.js";
import { markSvg } from "../mark-svg.js";
import { STEPPERS } from "../controls.js";
import { openConfirm } from "../dialogs.js";
import { pageHead, row, switchControl, stepper, choices, button } from "./kit.js";
import { PAGE_LINES, SETTINGS_SECTIONS, CLICK_PRESETS, CURSOR_PRESETS, VOICES, WAKE_PHRASES, matchPreset, matchCursorPreset, SETTING_DEFAULTS } from "./model.js";

const SECTION_NAMES = { clicking: "Clicking", cursor: "Cursor", voice: "Voice", display: "Display", about: "About VISION" };
const CLICK_KEYS = ["clickWink", "clickBlink", "clickMouth", "clickDwell"];
const speedDef = STEPPERS.find((def) => def.id === "sensitivity");

// One-app mode: no control that opens a native Windows dialog, since those need a hand.
const KIOSK = typeof location !== "undefined" && new URLSearchParams(location.search).has("kiosk");

export function createSettingsPage(ctx) {
	const { settings: st, engine } = ctx;
	let section = "clicking";
	const tabs = h("div", { class: "settings-tabs" });
	const body = h("div", { class: "settings-body" });
	const foot = h("div", { class: "settings-foot" });
	const el = h("div", { class: "page--settings" }, pageHead("Settings", PAGE_LINES.settings), tabs, body, foot);

	const changed = () => ctx.onChanged?.();
	const sw = (name, sentence, key, { onSet } = {}) => row(name, sentence, switchControl({
		label: name, get: () => Boolean(st.get(key)),
		set: (on) => { st.set(key, on); onSet?.(on); changed(); },
	}));

	// At least one click method stays on, or nothing outside VISION could be clicked.
	const clickSwitch = (name, sentence, key) => row(name, sentence, switchControl({
		label: name, get: () => Boolean(st.get(key)),
		set: (on) => {
			if (!on && CLICK_KEYS.every((k) => k === key || !st.get(k))) {
				ctx.toast("Keep at least one click method on.");
				return;
			}
			st.set(key, on);
			changed();
			render();
		},
	}));

	const renderers = {
		clicking: () => [
			row("Click method", "Start from a set. You can change each one below.", choices("Click method", CLICK_PRESETS.map((p) => ({
				label: p.label, checked: matchPreset(CLICK_PRESETS, st.get)?.id === p.id,
				onClick: () => { for (const [k, v] of Object.entries(p.values)) st.set(k, v); changed(); render(); },
			}))), { wide: true }),
			clickSwitch("Wink", "Wink your left eye to left-click, your right eye to right-click.", "clickWink"),
			clickSwitch("Blink", "Blink both eyes on purpose to left-click.", "clickBlink"),
			clickSwitch("Mouth", "Open your mouth to click.", "clickMouth"),
			clickSwitch("Dwell", "Hold the cursor still to click.", "clickDwell"),
			st.get("clickDwell") ? row("Dwell time", "How long to hold still before a dwell click.", stepper({
				label: "Dwell time", get: () => st.get("dwellTime") / 1000, set: (v) => st.set("dwellTime", Math.round(v * 10) * 100),
				min: 0.6, max: 2.0, step: 0.1, format: (v) => `${v.toFixed(1)} s`, onChange: changed,
			})) : null,
			sw("Keyboard", "Raise your eyebrows for 3 seconds to open the keyboard.", "eyebrowRaiseOpensKeyboard"),
			row("Pause method", "How to pause and resume face control without your hands.", choices("Pause method", [
				{ label: "Three quick blinks", checked: st.get("pauseMethod") !== "closeEyes", onClick: () => { st.set("pauseMethod", "blinks3"); changed(); render(); } },
				{ label: "Close your eyes for 2 seconds", checked: st.get("pauseMethod") === "closeEyes", onClick: () => { st.set("pauseMethod", "closeEyes"); changed(); render(); } },
			]), { wide: true }),
		],
		cursor: () => {
			const preset = matchCursorPreset(speedDef.get(st), st.get("headTrackingAcceleration"));
			const cams = h("div", { class: "uchoices", style: { "--n": "2" } }, h("span", { class: "srow__sentence" }, "Looking for cameras…"));
			navigator.mediaDevices?.enumerateDevices?.().then((devices) => {
				const list = devices.filter((d) => d.kind === "videoinput");
				const current = st.get("cameraDeviceId") || "";
				const pick = (id) => { st.set("cameraDeviceId", id); render(); };
				cams.replaceWith(choices("Camera", [
					{ label: "Default camera", checked: !current, onClick: () => pick("") },
					...list.slice(0, 3).map((cam, i) => ({ label: cam.label || `Camera ${i + 1}`, checked: cam.deviceId === current, onClick: () => pick(cam.deviceId) })),
				]));
			}, () => cams.replaceChildren(h("span", { class: "srow__sentence" }, "The camera list can’t be read right now.")));
			return [
				row("How it feels", "Speed, and how much further quick turns go.", choices("How it feels", CURSOR_PRESETS.map((p) => ({
					label: p.label, checked: preset?.id === p.id,
					onClick: () => {
						speedDef.set(st, p.speed, speedDef.get(st));
						st.set("headTrackingAcceleration", p.acceleration);
						changed();
						render();
					},
				}))), { wide: true }),
				row("Speed", "How far the cursor moves when you turn your head.", stepper({
					label: "Speed", get: () => speedDef.get(st), set: (v) => speedDef.set(st, v, speedDef.get(st)),
					min: speedDef.min, max: speedDef.max, step: 1, format: speedDef.format, onChange: () => { changed(); render(); },
				})),
				// Stability is the old Steadiness control: same key, range, step and behaviour.
				row("Stability", "Ignore small shakes of your head.", stepper({
					label: "Stability", get: () => engine.settings.get("headTrackingMinDistance"), set: (v) => engine.settings.set("headTrackingMinDistance", v),
					min: 0, max: 10, step: 1, format: (v) => String(v), onChange: changed,
				})),
				row("Calibrate", "Measure how far you can turn your head.", button("Calibrate", () => ctx.startCalibration())),
				row("Camera", "Which camera VISION uses.", cams, { wide: true }),
			];
		},
		voice: () => voiceRows(),
		display: () => [
			row("Island position", "Where the island sits on your screen.", choices("Island position", [
				["top-center", "Top centre"], ["top-right", "Top right"], ["bottom-center", "Bottom centre"],
			].map(([id, label]) => ({ label, checked: ctx.globals.get("islandPosition", "top-center") === id, onClick: () => { ctx.globals.set({ islandPosition: id }); render(); } }))), { wide: true }),
			sw("Show face mesh", "Show the dots on your face in the camera view.", "showMesh"),
			row("Theme", "Dark or light colours.", choices("Theme", [
				{ label: "Dark", checked: ctx.theme() !== "paper", onClick: () => { ctx.setTheme("ember"); render(); } },
				{ label: "Light", checked: ctx.theme() === "paper", onClick: () => { ctx.setTheme("paper"); render(); } },
			])),
			row("Start with Windows", "Start VISION when Windows starts.", switchControl({
				label: "Start with Windows", get: () => Boolean(ctx.globals.get("runAtLogin", false)), set: (on) => ctx.globals.set({ runAtLogin: on }),
			})),
			sw("Start face control", "Start face control as soon as VISION opens.", "startEnabled"),
			row("About VISION", "Version, history and privacy.", button("About VISION", () => { section = "about"; render(); }), { wide: true }),
		],
		about: () => aboutRows(),
	};

	function voiceRows() {
		const holder = h("div", { class: "srow srow--wide srow--plain" }, h("span", { class: "srow__sentence" }, "Loading…"));
		const out = [
			row("Wake phrase", "What you say to start talking to VISION.", choices("Wake phrase", WAKE_PHRASES.map((p) => ({
				label: p.label, checked: ctx.globals.get("wakePhrase", "hey-vision") === p.id,
				onClick: () => { ctx.globals.set({ wakePhrase: p.id }); render(); },
			})))),
			row("Sounds", "A short sound when VISION hears you.", switchControl({
				label: "Sounds", get: () => ctx.globals.get("soundsOn", true) !== false, set: (on) => ctx.globals.set({ soundsOn: on }),
			})),
		];
		if (!ctx.voice) {
			holder.replaceChildren(h("span", { class: "srow__sentence" }, "Voice is not part of this version. Face control works without it."));
			return [...out, holder];
		}
		const voiceRow = h("div", { class: "srow" });
		const langRow = h("div", { class: "srow" });
		ctx.voice.getConfig().then((config) => {
			if (!config) throw new Error("no voice config");
			const setConfig = (change) => ctx.voice.setConfig(change).then(render, () => { });
			voiceRow.replaceWith(row("VISION’s voice", "How VISION sounds when it talks.", choices("VISION’s voice", VOICES.map((v) => ({
				label: v.label, checked: config.voice === v.id, onClick: () => setConfig({ voice: v.id }),
			})))));
			langRow.replaceWith(row("Language", "The language VISION listens and speaks in.", choices("Language", [["auto", "Automatic"], ["en", "English"], ["hi", "Hindi"]].map(([value, label]) => ({
				label, checked: config.language === value, onClick: () => setConfig({ language: value }),
			})))));
			holder.replaceWith(keyForm(config));
		}).catch(() => holder.replaceChildren(h("span", { class: "srow__sentence" }, "Voice settings can’t be read right now. Face control still works.")));
		return [out[0], voiceRow, langRow, out[1], holder];
	}

	// Voice keys (Phase 1 behaviour): masked saved keys, Save gives "Saved · connecting…"
	// then "Voice ready" or a plain error.
	function keyForm(config) {
		const fields = config.keyFields ?? [];
		const inputs = fields.map((field) => h("input", {
			type: field.secret ? "password" : "text", "aria-label": field.label, autocomplete: "off", spellcheck: "false", class: "key-input",
		}));
		const agentText = (agent) => ({ ready: "Voice ready.", starting: "Connecting…", error: agent?.message || "Voice could not start." })[agent?.state] ?? "";
		const status = config.hasKeys
			? h("p", { class: "srow__sentence", "aria-live": "polite" }, `Keys are saved on this computer. ${agentText(config.agent)}`)
			: h("div", { class: "keys-missing", role: "alert" },
				h("b", {}, "Voice is off: it needs its keys."),
				h("span", {}, "A helper types these in once, or puts them in keys.env. Face control works without them."));
		const save = h("button", { class: "btn btn--ember", "data-dwell": true }, "Save keys");
		save.addEventListener("click", () => {
			const keys = Object.fromEntries(fields.map((field, i) => [field.name, inputs[i].value.trim()]));
			const empty = fields.filter((field) => !keys[field.name]).map((field) => field.label);
			const say = (text) => status.replaceChildren(h("span", {}, text));
			if (empty.length) return say(`Still empty: ${empty.join(", ")}.`);
			if (keys.LIVEKIT_URL && !/^(wss|https):\/\//i.test(keys.LIVEKIT_URL)) return say("The LiveKit URL should start with wss://");
			const watch = (tries) => ctx.voice.getConfig().then((next) => {
				if (!status.isConnected) return;
				const state = next?.agent?.state;
				if (state === "ready" || state === "error") return say(state === "ready" ? "Saved · Voice ready." : `Saved · ${agentText(next.agent)}`);
				if (tries >= 120) return say("Saved · still connecting. Check the internet connection.");
				setTimeout(() => watch(tries + 1), 1000);
			}, () => { });
			ctx.voice.saveKeys(keys).then(() => { say("Saved · connecting…"); watch(0); },
				(error) => say(`Could not save the keys: ${error?.message ?? error}`));
		});
		const block = h("div", { class: "srow srow--wide srow--keys" });
		// Typing keys needs the room: the other rows and Reset step aside until Done.
		const setOpen = (open) => {
			for (const sib of block.parentElement?.children ?? []) if (sib !== block) sib.hidden = open;
			foot.hidden = open;
			form.hidden = !open;
			toggle.hidden = open;
			if (saved) saved.hidden = open;
		};
		const form = h("div", { class: "key-form", hidden: true },
			h("div", { class: "key-grid" }, ...fields.map((field, i) => h("label", { class: "key-field" },
				h("span", { class: "srow__sentence" }, field.hint ? `${field.label} · ${field.hint}` : field.label), inputs[i]))),
			h("div", { class: "key-actions" }, button("Done", () => setOpen(false)), button("Keyboard", () => engine.openOnScreenKeyboard()), save));
		const head = h("div", { class: "srow__text" }, h("span", { class: "srow__name" }, "Voice keys"), status);
		const toggle = button(config.hasKeys ? "Change voice keys" : "Add voice keys", () => setOpen(true));
		const saved = config.hasKeys ? h("div", { class: "key-grid key-grid--saved" }, ...(config.savedKeys ?? []).map((key) => h("div", { class: "key-field" },
			h("span", { class: "srow__sentence" }, key.label), h("span", { class: "key-value" }, key.value)))) : null;
		block.append(h("div", { class: "key-head" }, head, toggle), saved ?? "", form);
		return block;
	}

	function aboutRows() {
		return [h("div", { class: "about" },
			h("div", { class: "about-mark" }, markSvg(64),
				h("div", {}, h("div", { class: "about__name" }, "VISION"), h("div", { class: "srow__sentence" }, `Version ${ctx.version() || "dev"}`)),
				h("div", { class: "session__spacer" }),
				button("Back to Display", () => { section = "display"; render(); })),
			h("p", { class: "prose" }, "Use your computer without your hands. Move your head to move the cursor, use your face to click, and say “Hey Vision” to ask for things."),
			h("p", { class: "prose" }, h("strong", {}, "History: "), "VISION 1 · 1st prize, Event Expo 2026. Tested by many people."),
			h("p", { class: "prose" }, h("strong", {}, "Privacy: "), "the camera picture stays on this computer and is never saved. Your voice goes online only while VISION is listening to you. VISION sends no usage data or crash reports."),
			KIOSK ? null : h("div", { class: "key-actions" },
				button("Export settings", () => ctx.host.appCommand("export-settings")),
				button("Import settings", () => ctx.host.appCommand("import-settings"))),
			h("div", { class: "credits" }, "Credits: MediaPipe Face Mesh and TensorFlow.js (Apache 2.0); Geist, Geist Mono and Doto fonts (OFL); sounds from Kenney Interface Sounds by Kenney.nl (CC0). Full licences are in THIRD_PARTY_NOTICES.md in the VISION folder."),
		)];
	}

	// Recommended values per section. Voice keys and the camera are never reset.
	const RESETS = {
		clicking: () => {
			for (const key of [...CLICK_KEYS, "dwellTime", "pauseMethod", "eyebrowRaiseOpensKeyboard"]) st.set(key, SETTING_DEFAULTS[key]);
		},
		cursor: () => {
			const normal = CURSOR_PRESETS.find((p) => p.id === "normal");
			speedDef.set(st, normal.speed, speedDef.get(st));
			st.set("headTrackingAcceleration", normal.acceleration);
			engine.settings.set("headTrackingMinDistance", SETTING_DEFAULTS.headTrackingMinDistance);
		},
		voice: () => {
			ctx.globals.set({ wakePhrase: "hey-vision", soundsOn: true });
			ctx.voice?.setConfig({ voice: "Aoede", language: "auto" }).then(render, () => { });
		},
		display: () => {
			ctx.globals.set({ islandPosition: "top-center" });
			st.set("showMesh", true);
			ctx.setTheme("ember");
		},
	};

	function render() {
		tabs.replaceChildren(choices("Settings section", SETTINGS_SECTIONS.map((name) => ({
			label: SECTION_NAMES[name], checked: name === section || (section === "about" && name === "display"),
			onClick: () => { section = name; render(); },
		}))));
		body.replaceChildren(...renderers[section]().filter(Boolean));
		foot.hidden = false;
		body.dataset.section = section;
		foot.replaceChildren(...(RESETS[section] ? [button("Reset to recommended", () => openConfirm(ctx.layer, {
			title: `Reset ${SECTION_NAMES[section]} to recommended?`,
			text: null,
			confirmLabel: "Yes, reset",
			onConfirm: () => { RESETS[section](); changed(); render(); },
			secondary: { label: "Keep mine", onClick: () => { } },
			cancel: false,
			stacked: true,
		}))] : []));
	}

	return {
		el,
		enter(next) {
			if (next) section = next;
			render();
		},
		// No refresh on outside setting changes: it would wipe keys being typed.
		// Preview / QA: which section is showing.
		section: () => section,
	};
}
