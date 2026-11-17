// Sheets and dialogs: Settings (with About), Profiles, Confirm. Everything is a 64px dwell target;
// long lists are paged (Previous / Next) instead of scrolled, so they work hands-free.

import { h, icons, setText } from "./dom.js";
import { markSvg } from "./mark-svg.js";
import { clickingModeLabel } from "./labels.js";
import { createControlsEditor } from "./controls-editor.js";
import { choosePlan, DEFAULT_PLAN } from "./control-map.js";
import { STEPPERS } from "./controls.js";

function closeButton(onClick) {
	return h("button", { class: "btn btn--ghost", "data-dwell": true, "aria-label": "Close", onclick: onClick }, icons.close(), "Close");
}

/** Generic right-hand sheet. Returns { el, body, close }. */
export function openSheet(layer, { title, onClose }) {
	const scrim = h("div", { class: "scrim" });
	const body = h("div", { class: "sheet__body" });
	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		window.removeEventListener("keydown", onKey);
		scrim.remove();
		sheet.remove();
		onClose?.();
	};
	const sheet = h("aside", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
		h("div", { class: "sheet__head" }, h("div", { class: "sheet__title" }, title), closeButton(close)),
		body,
	);
	const onKey = (event) => {
		if (event.key === "Escape") close();
	};
	window.addEventListener("keydown", onKey);
	scrim.addEventListener("click", close);
	layer.append(scrim, sheet);
	return { sheet, body, close };
}

// cancel: false drops the Cancel button and the click-outside dismiss, when `secondary`
// already declines and a stray click must not answer for the user.
// `secondary` sits alone on the left; `alt` sits next to the main button on the right.
export function openConfirm(layer, { title, text, confirmLabel, danger = false, onConfirm, secondary = null, alt = null, cancel = true }) {
	const scrim = h("div", { class: "scrim" });
	const close = () => {
		scrim.remove();
		box.remove();
	};
	const box = h("div", { class: "confirm", role: "alertdialog", "aria-modal": "true", "aria-label": title },
		h("div", { class: "confirm__title" }, title),
		h("div", { class: "prose" }, text),
		h("div", { class: "confirm__actions" },
			secondary ? h("button", { class: `btn ${secondary.danger ? "btn--danger" : "btn--ghost"}`, "data-dwell": true, "data-dwell-delay": secondary.delay, onclick: () => { close(); secondary.onClick(); } }, secondary.label) : null,
			h("div", { class: "session__spacer" }),
			alt ? h("button", { class: "btn", "data-dwell": true, onclick: () => { close(); alt.onClick(); } }, alt.label) : null,
			cancel ? h("button", { class: "btn", "data-dwell": true, onclick: close }, "Cancel") : null,
			h("button", { class: `btn ${danger ? "btn--danger" : "btn--ember"} btn--wide`, "data-dwell": true, onclick: () => { close(); onConfirm(); } }, confirmLabel),
		),
	);
	if (cancel) scrim.addEventListener("click", close);
	layer.append(scrim, box);
	return { close, box };
}

function section(title, ...children) {
	return h("div", { class: "sheet__section" }, h("span", { class: "label" }, title), ...children);
}

function choice({ label, tech, checked, onClick }) {
	return h("button", { class: "choice", role: "radio", "aria-checked": String(Boolean(checked)), "data-dwell": true, onclick: onClick },
		h("span", {}, label), tech ? h("span", { class: "tech" }, tech) : null);
}

function toggleRow({ label, tech, get, set, refresh }) {
	const el = h("button", { class: "toggle", role: "switch", "data-dwell": true, "aria-checked": String(Boolean(get())) },
		h("span", { class: "toggle__name" }, label), h("span", { class: "tech" }, tech));
	el.addEventListener("click", () => {
		set(!get());
		el.setAttribute("aria-checked", String(Boolean(get())));
		refresh?.();
	});
	return el;
}

/** Paged grid of choices (hands-free friendly). */
function pagedChoices({ items, pageSize = 9, render }) {
	let page = 0;
	const grid = h("div", { class: "choice-grid" });
	const indicator = h("span", { class: "label" });
	const prev = h("button", { class: "btn", "data-dwell": true, "aria-label": "Previous page" }, icons.arrowLeft(), "Previous");
	const next = h("button", { class: "btn", "data-dwell": true, "aria-label": "Next page" }, "Next", icons.arrowRight());
	const pages = Math.max(1, Math.ceil(items.length / pageSize));
	const draw = () => {
		grid.replaceChildren(...items.slice(page * pageSize, page * pageSize + pageSize).map(render));
		setText(indicator, `${page + 1} / ${pages}`);
		prev.disabled = page === 0;
		next.disabled = page >= pages - 1;
	};
	prev.addEventListener("click", () => { page = Math.max(0, page - 1); draw(); });
	next.addEventListener("click", () => { page = Math.min(pages - 1, page + 1); draw(); });
	const selected = items.findIndex((item) => item.selected);
	if (selected >= 0) page = Math.floor(selected / pageSize);
	draw();
	return h("div", { class: "sheet__section" }, grid, pages > 1 ? h("div", { class: "page-nav" }, prev, indicator, next) : null);
}

const CLICK_MODES = ["blink", "open-mouth-simple", "dwell", "open-mouth", "open-mouth-ignoring-eyes", "off"];
const CLICK_MODE_HINTS = {
	"blink": "wink left or right",
	"open-mouth-simple": "open to click, close to release",
	"dwell": "rest the cursor to click",
	"open-mouth": "mouth + wink for right / middle",
	"open-mouth-ignoring-eyes": "hold the button while open",
	"off": "move only, no clicks",
};

// One-app mode (VISION.bat): no control that opens a native Windows dialog (file
// pickers, camera property pages) or the classic UI, since those need a hand.
const KIOSK = typeof location !== "undefined" && new URLSearchParams(location.search).has("kiosk");

/** The one Settings view: Pointer, Clicking, Voice, About. */
// `controlMap`: { get(), set(plan) } for the person's own control choices (optional).
// `voice`: { getConfig, setConfig, saveKeys, getWake, setWake, getSounds, setSounds } (absent when voice is off).
export function openSettings(layer, { engine, host, onChanged, controlMap, voice, onRecalibrate, onKeyboard, version, initialTab = "Pointer" }) {
	const st = engine.settings;
	const { body, close } = openSheet(layer, { title: "Settings" });
	const tabs = ["Pointer", "Clicking", "Voice", "About"];
	let tab = tabs.includes(initialTab) ? initialTab : "Pointer";
	const tabRow = h("div", { class: "choice-grid", style: { "grid-template-columns": "repeat(4, minmax(0, 1fr))" } });
	const content = h("div", { style: { display: "flex", "flex-direction": "column", gap: "18px" } });
	body.append(tabRow, content);

	const changed = () => onChanged?.();
	const settingToggle = (label, key, tech) => toggleRow({
		label, tech,
		get: () => Boolean(st.get(key)),
		set: (on) => { st.set(key, on); changed(); },
	});

	function stepRow(label, tech, { get, set, min, max, step, format }) {
		const value = h("span", { class: "stepper__value" }, "");
		const minus = h("button", { class: "stepper__btn", "data-dwell": true, "aria-label": `Decrease ${label}` }, icons.minus());
		const plus = h("button", { class: "stepper__btn", "data-dwell": true, "aria-label": `Increase ${label}` }, icons.plus());
		const draw = () => {
			const v = get();
			setText(value, format(v));
			minus.disabled = v <= min + 1e-9;
			plus.disabled = v >= max - 1e-9;
		};
		minus.addEventListener("click", () => { set(Math.max(min, Math.round((get() - step) / step) * step)); draw(); changed(); });
		plus.addEventListener("click", () => { set(Math.min(max, Math.round((get() + step) / step) * step)); draw(); changed(); });
		draw();
		return h("div", { class: "stepper" },
			h("div", { class: "stepper__title" }, h("span", { class: "stepper__name" }, label), h("span", { class: "tech" }, tech)),
			h("div", { class: "stepper__row" }, minus, value, plus));
	}
	const stepperFor = (def) => stepRow(def.name, def.sub, {
		get: () => def.get(st), set: (v) => def.set(st, v, def.get(st)), min: def.min, max: def.max, step: 1, format: def.format,
	});

	// Close-eyes is the only hands-free way to resume from pause, so one stray dwell must
	// not turn it off: switching it off needs a second, longer dwell on "Turn off".
	const closeEyesToggle = () => {
		const el = h("button", { class: "toggle", role: "switch", "data-dwell": true, "aria-checked": String(Boolean(st.get("closeEyesToToggle"))) },
			h("span", { class: "toggle__name" }, "Close eyes 2s to pause / resume"), h("span", { class: "tech" }, "hands-free pause"));
		el.addEventListener("click", () => {
			if (!st.get("closeEyesToToggle")) {
				st.set("closeEyesToToggle", true);
				changed();
				render();
				return;
			}
			openConfirm(layer, {
				title: "Turn off close-eyes resume?",
				text: "While face control is paused, closing your eyes is the only hands-free way back. With it off, only F9 or a mouse can resume.",
				confirmLabel: "Keep it on",
				onConfirm: () => { },
				secondary: { label: "Turn off", delay: 1500, onClick: () => { st.set("closeEyesToToggle", false); changed(); render(); } },
				cancel: false,
			});
		});
		return el;
	};

	const renderers = {
		Pointer: () => {
			const cams = h("div", { class: "choice-grid", style: { "grid-template-columns": "repeat(2, minmax(0, 1fr))" } }, h("span", { class: "label" }, "Looking for cameras…"));
			navigator.mediaDevices?.enumerateDevices?.().then((devices) => {
				const list = devices.filter((d) => d.kind === "videoinput");
				const current = st.get("cameraDeviceId") || "";
				cams.replaceChildren(
					choice({ label: "Default camera", tech: "system default", checked: !current, onClick: () => { st.set("cameraDeviceId", ""); render(); } }),
					...list.map((cam, i) => choice({
						label: cam.label || `Camera ${i + 1}`,
						tech: cam.deviceId === current ? "in use" : "",
						checked: cam.deviceId === current,
						onClick: () => { st.set("cameraDeviceId", cam.deviceId); render(); },
					})),
				);
			}, () => cams.replaceChildren(h("span", { class: "label" }, "Camera list unavailable")));
			return [
				section("CURSOR", h("div", { class: "row-grid" },
					...STEPPERS.filter((def) => def.id !== "dwellTime").map(stepperFor),
					stepRow("Steadiness", "Ignore tiny movements", {
						get: () => st.get("headTrackingMinDistance"), set: (v) => st.set("headTrackingMinDistance", v),
						min: 0, max: 10, step: 1, format: (v) => String(v),
					}),
					stepRow("Tilt to point", "Point by head angle, not movement", {
						get: () => st.get("headTrackingTiltInfluence"), set: (v) => st.set("headTrackingTiltInfluence", Math.round(v * 10) / 10),
						min: 0, max: 1, step: 0.1, format: (v) => `${Math.round(v * 100)}%`,
					}),
				)),
				section("CALIBRATION", h("div", { class: "row-grid" },
					h("button", { class: "btn btn--ember", "data-dwell": true, onclick: () => { close(); onRecalibrate?.(); } }, "Recalibrate"),
					settingToggle("Start tracking on launch", "startEnabled", "no need to press F9"),
				)),
				section("CAMERA", cams, h("div", { class: "row-grid" },
					settingToggle("Mirror the camera view", "mirror"),
					h("button", { class: "btn", "data-dwell": true, onclick: () => engine.useCamera() }, "Try the camera again"),
					host.canOpenCameraSettings && !KIOSK ? h("button", { class: "btn", "data-dwell": true, onclick: () => host.openCameraSettings(engine.getVideoStream()?.getVideoTracks?.()[0]?.label) }, "Camera settings…") : null,
				)),
			];
		},
		Clicking: () => [
			section("DWELL", h("div", { class: "row-grid" },
				stepperFor(STEPPERS.find((def) => def.id === "dwellTime")),
				settingToggle("Dwell drag", "dwellDrag", "rest to grab, rest again to drop"),
			)),
			controlMap ? section("YOUR CONTROLS", h("p", { class: "prose" }, "Choose which face gesture does each action. Rest on a choice to switch."),
				createControlsEditor({ plan: controlMap.get() ?? DEFAULT_PLAN, onChange: (plan) => { controlMap.set(plan); changed(); } }).el) : null,
			section("CLICK METHOD", h("div", { class: "choice-grid" }, ...CLICK_MODES.map((mode) => choice({
				label: clickingModeLabel(mode),
				tech: CLICK_MODE_HINTS[mode],
				checked: st.get("clickingMode") === mode,
				onClick: () => {
					st.set("clickingMode", mode);
					// Keep "Your controls" in step with the click method.
					if (controlMap && (mode === "blink" || mode === "dwell")) {
						controlMap.set(choosePlan(controlMap.get() ?? DEFAULT_PLAN, "leftClick", mode === "dwell" ? "dwell" : "leftWink"));
					}
					changed();
					render();
				},
			})))),
			section("GESTURES", h("div", { class: "row-grid" },
				closeEyesToggle(),
				settingToggle("Raise brows 3s for keyboard", "eyebrowRaiseOpensKeyboard", "opens the on-screen keyboard"),
				settingToggle("Sound effects", "soundEffects", "a soft click on every click"),
				settingToggle("Swap mouse buttons", "swapMouseButtons", "match swapped system buttons"),
			)),
			section("FINE TUNING", h("div", { class: "row-grid" },
				stepRow("Delay before dragging", "Hold still after a click starts", {
					get: () => st.get("delayBeforeDragging"), set: (v) => st.set("delayBeforeDragging", v),
					min: 0, max: 1000, step: 100, format: (v) => `${(v / 1000).toFixed(1)}s`,
				}),
			)),
		],
		Voice: () => voiceSection(),
		About: () => aboutContent({ version, host, engine }),
	};

	function voiceSection() {
		const holder = h("div", { style: { display: "flex", "flex-direction": "column", gap: "18px" } }, h("span", { class: "label" }, "Loading…"));
		if (!voice) {
			holder.replaceChildren(h("p", { class: "prose" }, "Voice is not part of this version. Face control works without it."));
			return [holder];
		}
		Promise.all([voice.getConfig(), voice.getWake(), voice.getSounds?.()]).then(([config, wake, sounds]) => {
			if (!config) throw new Error("no voice config");
			holder.replaceChildren(
				config.hasKeys ? null : keyForm(config),
				section("WAKE WORD", h("p", { class: "prose" }, "Say “Vision”. Heard on this computer only. Relaxed hears a quieter voice; Normal ignores more background talk."),
					h("div", { class: "choice-grid", style: { "grid-template-columns": "repeat(2, minmax(0, 1fr))" } },
						choice({ label: "Relaxed", tech: "quiet voice, quiet room", checked: wake === "relaxed", onClick: () => { voice.setWake("relaxed"); render(); } }),
						choice({ label: "Normal", tech: "default", checked: wake !== "relaxed", onClick: () => { voice.setWake("normal"); render(); } }),
					)),
				sounds ? soundsSection(sounds) : null,
				section("LANGUAGE", h("div", { class: "choice-grid", style: { "grid-template-columns": "repeat(3, minmax(0, 1fr))" } },
					...[["auto", "Auto"], ["en", "English"], ["hi", "Hindi"]].map(([value, label]) => choice({
						label, checked: config.language === value,
						onClick: () => voice.setConfig({ language: value }).then(render, () => { }),
					})))),
				section("VOICE", pagedChoices({
					items: (config.voices ?? []).map((v) => ({ value: v.name, label: v.name, tech: v.style, selected: v.name === config.voice })),
					pageSize: 6,
					render: (item) => choice({ label: item.label, tech: item.tech, checked: item.selected, onClick: () => voice.setConfig({ voice: item.value }).then(render, () => { }) }),
				})),
				config.hasKeys ? keyForm(config) : null,
			);
		}).catch(() => holder.replaceChildren(h("p", { class: "prose" }, "Voice settings are not available right now. Face control still works.")));
		return [holder];
	}

	// The wake / listening / done / error sounds. `sounds`: { on, volume } from the settings file.
	function soundsSection(sounds) {
		const save = () => voice.setSounds({ soundsOn: sounds.on, soundVolume: sounds.volume });
		return section("SOUNDS", h("div", { class: "row-grid" },
			toggleRow({ label: "Sounds", tech: "a short sound at each step", get: () => sounds.on, set: (on) => { sounds.on = on; save(); } }),
			stepRow("Sound volume", "VISION's voice has its own volume", {
				get: () => sounds.volume, set: (v) => { sounds.volume = v; save(); },
				min: 10, max: 100, step: 10, format: (v) => `${v}%`,
			}),
		));
	}

	function keyForm(config) {
		const fields = config.keyFields ?? [];
		const inputs = fields.map((field) => h("input", {
			type: field.secret ? "password" : "text", "aria-label": field.label, autocomplete: "off", spellcheck: "false",
			style: { height: "56px", padding: "0 16px", "font-size": "16px", "border-radius": "12px", border: "1px solid var(--rule-strong)", background: "var(--ink-2)", color: "inherit" },
		}));
		// Missing keys: say plainly what is off and who fills this in. A helper types them once.
		const status = config.hasKeys
			? h("p", { class: "prose" }, "Keys are saved, encrypted on this computer.")
			: h("div", { class: "keys-missing", role: "alert" },
				h("b", {}, "Voice is off: it needs its keys."),
				h("span", {}, "A helper types these in once. They stay encrypted on this computer. Face control works without them."));
		const save = h("button", { class: "btn btn--ember btn--wide", "data-dwell": true }, "Save keys");
		save.addEventListener("click", () => {
			const keys = Object.fromEntries(fields.map((field, i) => [field.name, inputs[i].value.trim()]));
			const empty = fields.filter((field) => !keys[field.name]).map((field) => field.label);
			const say = (text) => status.replaceChildren(h("span", {}, text));
			if (empty.length) return say(`Still empty: ${empty.join(", ")}.`);
			if (keys.LIVEKIT_URL && !/^(wss|https):\/\//i.test(keys.LIVEKIT_URL)) return say("The LiveKit URL should start with wss://");
			voice.saveKeys(keys).then(() => say("Keys saved. Voice is starting."),
				(error) => say(`Could not save the keys: ${error?.message ?? error}`));
		});
		const form = h("div", { style: { display: "flex", "flex-direction": "column", gap: "10px" } },
			...fields.map((field, i) => h("label", { style: { display: "flex", "flex-direction": "column", gap: "6px" } }, h("span", { class: "label label--dim" }, field.hint ? `${field.label} · ${field.hint}` : field.label), inputs[i])),
			h("div", { class: "row-grid" }, onKeyboard ? h("button", { class: "btn", "data-dwell": true, onclick: () => onKeyboard() }, "Keyboard") : null, save));
		if (config.hasKeys) {
			form.hidden = true;
			const reveal = h("button", { class: "btn", "data-dwell": true, onclick: () => { form.hidden = false; reveal.remove(); } }, "Change voice keys");
			return section("KEYS", status, reveal, form);
		}
		return section("KEYS", status, form);
	}

	function render() {
		tabRow.replaceChildren(...tabs.map((name) => choice({ label: name, checked: name === tab, onClick: () => { tab = name; render(); } })));
		content.replaceChildren(...renderers[tab]().filter(Boolean));
	}
	render();
	return { close };
}

function aboutContent({ version, host, engine }) {
	// Diagnostics are for a helper or support: one dwell away, hidden until asked for.
	const diag = diagnostics(engine);
	diag.hidden = true;
	const diagBtn = h("button", { class: "btn", "data-dwell": true, style: { "margin-left": "auto" }, "aria-expanded": "false" }, "Diagnostics");
	diagBtn.addEventListener("click", () => {
		diag.hidden = !diag.hidden;
		diagBtn.setAttribute("aria-expanded", String(!diag.hidden));
	});
	return [
		h("div", { class: "about-mark" },
			markSvg(72),
			h("div", {},
				h("div", { style: { "font-size": "24px", "font-weight": "600" } }, "VISION"),
				h("div", { class: "label" }, `VERSION ${version || "DEV"}`)),
			diagBtn),
		diag,
		h("p", { class: "prose" }, "Use your computer without your hands. Move your head to move the cursor, use your face to click, and say “Vision” to ask for things."),
		h("p", { class: "prose" }, h("strong", {}, "If something goes wrong: "), "close both eyes for 2 seconds to pause or resume. A helper can press F9, or move the mouse to take over. A held mouse button is always let go when VISION pauses, closes or stops."),
		h("p", { class: "prose" }, h("strong", {}, "Privacy: "), "the camera picture stays on this computer and is never saved. Your voice goes online only while VISION is listening to you. VISION sends no usage data or crash reports."),
		section("HISTORY", h("p", { class: "prose" }, "VISION 1 · 1st prize, Event Expo 2026. Tested by many people.")),
		KIOSK ? null : section("SETTINGS FILE", h("div", { class: "row-grid" },
			h("button", { class: "btn", "data-dwell": true, onclick: () => host.appCommand("export-settings") }, "Export settings…"),
			h("button", { class: "btn", "data-dwell": true, onclick: () => host.appCommand("import-settings") }, "Import settings…"),
		)),
		h("div", { class: "credits" }, "Credits: MediaPipe Face Mesh and TensorFlow.js (Apache 2.0); Geist, Geist Mono and Doto fonts (OFL); sounds from Kenney Interface Sounds by Kenney.nl (CC0). Full licences are in THIRD_PARTY_NOTICES.md in the VISION folder."),
	];
}

/** Live numbers for a helper or support: head angles, tracked points, camera rate. */
function diagnostics(engine) {
	const out = h("pre", { class: "prose", style: { "font-family": "var(--font-mono, monospace)", "font-size": "14px", margin: "0" } }, "");
	const signed = (v) => `${v >= 0 ? "+" : ""}${Number(v || 0).toFixed(1)}°`;
	const draw = () => {
		const st = engine.getState?.();
		if (!st) return;
		// User's side: turning right is positive (the engine counts left as positive).
		setText(out, [
			`Status       ${st.status}${st.paused ? " (paused)" : ""}`,
			`Camera       ${st.camera?.status ?? "-"} · ${st.camera?.width ?? "-"}×${st.camera?.height ?? "-"} · ${Math.round(st.fps || 0)} fps`,
			`Face mesh    ${st.facemeshHz ?? "-"} Hz · ${st.points ?? 0} flow points`,
			`Head         turn ${signed(-st.pose?.yaw)} · tilt ${signed(st.pose?.pitch)} · roll ${signed(st.pose?.roll)}`,
			`Click method ${st.clickingMode}`,
		].join("\n"));
	};
	draw();
	const timer = setInterval(() => (out.isConnected ? out.offsetParent && draw() : clearInterval(timer)), 250);
	return section("DIAGNOSTICS", out);
}

export function openProfiles(layer, { profiles, onChanged }) {
	const { body, close } = openSheet(layer, { title: "Profiles" });
	function render() {
		const active = profiles.active();
		body.replaceChildren(
			h("p", { class: "prose" }, "A profile keeps one person's sensitivity, click method and calibration. Switch between people in one step."),
			pagedChoices({
				items: profiles.list().map((name) => ({ value: name, label: name, selected: name === active })),
				pageSize: 6,
				render: (item) => choice({
					label: item.label,
					tech: item.selected ? "active" : "switch to this profile",
					checked: item.selected,
					onClick: () => { profiles.switchTo(item.value); onChanged?.(); render(); },
				}),
			}),
			h("div", { class: "row-grid" },
				h("button", { class: "btn", "data-dwell": true, onclick: () => { profiles.create(); onChanged?.(); render(); } }, "New profile from current"),
				h("button", { class: "btn", "data-dwell": true, onclick: () => { profiles.saveActive(); onChanged?.(); render(); } }, "Save current settings"),
			),
		);
	}
	render();
	return { close };
}
