// Sheets and dialogs: Settings, Profiles, About, Confirm. Everything is a 64px dwell target;
// long lists are paged (Previous / Next) instead of scrolled, so they work hands-free.

import { h, icons, setText } from "./dom.js";
import { markSvg } from "./mark-svg.js";
import { clickingModeLabel } from "./labels.js";
import { createControlsEditor } from "./controls-editor.js";
import { choosePlan, DEFAULT_PLAN } from "./control-map.js";

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

export function openConfirm(layer, { title, text, confirmLabel, danger = false, onConfirm, secondary = null }) {
	const scrim = h("div", { class: "scrim" });
	const close = () => {
		scrim.remove();
		box.remove();
	};
	const box = h("div", { class: "confirm", role: "alertdialog", "aria-modal": "true", "aria-label": title },
		h("div", { class: "confirm__title" }, title),
		h("div", { class: "prose" }, text),
		h("div", { class: "confirm__actions" },
			secondary ? h("button", { class: "btn btn--ghost", "data-dwell": true, onclick: () => { close(); secondary.onClick(); } }, secondary.label) : null,
			h("div", { class: "session__spacer" }),
			h("button", { class: "btn", "data-dwell": true, onclick: close }, "Cancel"),
			h("button", { class: `btn ${danger ? "btn--danger" : "btn--ember"} btn--wide`, "data-dwell": true, onclick: () => { close(); onConfirm(); } }, confirmLabel),
		),
	);
	scrim.addEventListener("click", close);
	layer.append(scrim, box);
	return { close };
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

/** Settings sheet: "Settings" from the old menu bar plus every remaining engine setting. */
// `controlMap`: { get(), set(plan) } for the person's own control choices (optional).
export function openSettings(layer, { engine, host, theme, onThemeChange, onChanged, controlMap }) {
	const st = engine.settings;
	const { body, close } = openSheet(layer, { title: "Settings" });
	const tabs = ["General", "Clicking", "Camera", "Language", "Data"];
	let tab = "General";
	const tabRow = h("div", { class: "choice-grid", style: { "grid-template-columns": "repeat(5, minmax(0, 1fr))" } });
	const content = h("div", { style: { display: "flex", "flex-direction": "column", gap: "18px" } });
	body.append(tabRow, content);

	const changed = () => onChanged?.();
	const settingToggle = (label, key, tech, invert = false) => toggleRow({
		label, tech,
		get: () => invert ? st.get(key) === false : Boolean(st.get(key)),
		set: (on) => { st.set(key, invert ? !on : on); changed(); },
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

	const renderers = {
		General: () => [
			section("APPEARANCE", h("div", { class: "choice-grid", style: { "grid-template-columns": "repeat(2, minmax(0, 1fr))" } },
				choice({ label: "Ember Dark", tech: "default", checked: theme() === "ember", onClick: () => { onThemeChange("ember"); render(); } }),
				choice({ label: "Paper Light", tech: "for projectors", checked: theme() === "paper", onClick: () => { onThemeChange("paper"); render(); } }),
			)),
			section("GESTURES", h("div", { class: "row-grid" },
				settingToggle("Close eyes 2s to pause / resume", "closeEyesToToggle", "hands-free pause"),
				settingToggle("Raise brows 3s for keyboard", "eyebrowRaiseOpensKeyboard", "opens the on-screen keyboard"),
			)),
			section("APP", h("div", { class: "row-grid" },
				settingToggle("Sound effects", "soundEffects", "a soft click on every click"),
				settingToggle("Start tracking on launch", "startEnabled", "no need to press F9"),
				settingToggle("Run at login", "runAtLogin", "starts with Windows"),
				settingToggle("Swap mouse buttons", "swapMouseButtons", "match swapped system buttons"),
			)),
		],
		Clicking: () => [
			controlMap ? section("YOUR CONTROLS", h("p", { class: "prose" }, "Choose which face gesture (or your voice) does each action. Rest on a choice to switch."),
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
			section("FINE TUNING", h("div", { class: "row-grid" },
				stepRow("Delay before dragging", "Hold still after a click starts", {
					get: () => st.get("delayBeforeDragging"), set: (v) => st.set("delayBeforeDragging", v),
					min: 0, max: 1000, step: 100, format: (v) => `${(v / 1000).toFixed(1)}s`,
				}),
				stepRow("Motion threshold", "Ignore tiny movements", {
					get: () => st.get("headTrackingMinDistance"), set: (v) => st.set("headTrackingMinDistance", v),
					min: 0, max: 10, step: 1, format: (v) => String(v),
				}),
				stepRow("Head tilt influence", "Point by angle, not motion", {
					get: () => st.get("headTrackingTiltInfluence"), set: (v) => st.set("headTrackingTiltInfluence", Math.round(v * 10) / 10),
					min: 0, max: 1, step: 0.1, format: (v) => `${Math.round(v * 100)}%`,
				}),
			)),
		],
		Camera: () => {
			const list = h("div", { class: "choice-grid", style: { "grid-template-columns": "repeat(2, minmax(0, 1fr))" } }, h("span", { class: "label" }, "Looking for cameras…"));
			navigator.mediaDevices?.enumerateDevices?.().then((devices) => {
				const cams = devices.filter((d) => d.kind === "videoinput");
				const current = st.get("cameraDeviceId") || "";
				list.replaceChildren(
					choice({ label: "Default camera", tech: "system default", checked: !current, onClick: () => { st.set("cameraDeviceId", ""); render(); } }),
					...cams.map((cam, i) => choice({
						label: cam.label || `Camera ${i + 1}`,
						tech: cam.deviceId === current ? "in use" : "",
						checked: cam.deviceId === current,
						onClick: () => { st.set("cameraDeviceId", cam.deviceId); render(); },
					})),
				);
			}, () => list.replaceChildren(h("span", { class: "label" }, "Camera list unavailable")));
			return [
				section("CAMERA SOURCE", list),
				section("VIEW", h("div", { class: "row-grid" }, settingToggle("Mirror the camera view", "mirror"))),
				section("TROUBLESHOOTING", h("div", { class: "row-grid" },
					h("button", { class: "btn", "data-dwell": true, onclick: () => engine.useCamera() }, "Retry camera"),
					host.canOpenCameraSettings && !KIOSK ? h("button", { class: "btn", "data-dwell": true, onclick: () => host.openCameraSettings(engine.getVideoStream()?.getVideoTracks?.()[0]?.label) }, "Camera settings…") : null,
				)),
			];
		},
		Language: () => {
			const meta = st.describe("language");
			const current = st.get("language");
			return [
				h("p", { class: "prose" }, "Changing the language restarts the tracking engine for a moment."),
				pagedChoices({
					items: (meta?.options ?? []).map((o) => ({ ...o, selected: o.value === current })),
					pageSize: 12,
					render: (o) => choice({ label: o.label, checked: o.selected, onClick: () => { st.set("language", o.value); close(); } }),
				}),
			];
		},
		Data: () => [
			KIOSK ? section("SETTINGS FILE", h("p", { class: "prose" }, "Your settings are saved automatically. Say “VISION, back to start” to reset them for the next person.")) : null,
			KIOSK ? null : section("SETTINGS FILE", h("div", { class: "row-grid" },
				h("button", { class: "btn", "data-dwell": true, onclick: () => host.appCommand("export-settings") }, "Export settings…"),
				h("button", { class: "btn", "data-dwell": true, onclick: () => host.appCommand("import-settings") }, "Import settings…"),
			)),
			KIOSK ? null : section("CLASSIC INTERFACE", h("p", { class: "prose" }, "The original research interface is still available for comparison."),
				h("div", { class: "row-grid" }, h("button", { class: "btn", "data-dwell": true, onclick: () => host.appCommand("open-legacy-ui") }, "Restart in classic UI"))),
			section("PRIVACY", h("p", { class: "prose" }, "Face control runs entirely on this computer: camera video never leaves it and is never saved. The voice assistant sends audio online only while it listens. No telemetry or crash reports.")),
		],
	};

	function render() {
		tabRow.replaceChildren(...tabs.map((name) => choice({ label: name, checked: name === tab, onClick: () => { tab = name; render(); } })));
		content.replaceChildren(...renderers[tab]().filter(Boolean));
	}
	render();
	return { close };
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

export function openAbout(layer, { version }) {
	const { body, close } = openSheet(layer, { title: "About" });
	body.append(
		h("div", { class: "about-mark" },
			markSvg(72),
			h("div", {},
				h("div", { style: { "font-size": "24px", "font-weight": "600" } }, "VISION Face Control"),
				h("div", { class: "label" }, `VERSION ${version || "DEV"} · APERTURE`))),
		h("p", { class: "prose" }, "Control your computer with your head. VISION reads your face through the webcam: head movement moves the cursor, and winks, an open mouth, raised brows or a steady dwell click for you. It is built for people who cannot use their hands."),
		h("p", { class: "prose" }, h("strong", {}, "Failsafes: "), "F9 pauses at any time. Moving the physical mouse takes over for two seconds. Pausing, closing or a crash always releases any held mouse button."),
		h("p", { class: "prose" }, h("strong", {}, "Privacy: "), "everything runs on this computer. Nothing is uploaded."),
		h("div", { class: "credits" }, "Open-source credits: MediaPipe Face Mesh, TensorFlow.js, clmtrackr and jsfeat; Geist, Geist Mono and Doto fonts (OFL)."),
	);
	return { close };
}
