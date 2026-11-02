// Attitude indicator: an aircraft-style artificial horizon showing live head pitch and
// roll, with Pitch / Roll / Yaw readouts in Doto under the dial. Real data from
// engine.getState().pose. Calibration adds a yaw heading tape for the measured range.

import { h, s, setText, signed } from "./dom.js";

const SIZE = 240;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = SIZE / 2 - 4; // bezel tick radius
const r = R - 16; // horizon window radius
const PITCH_PX = r / 40; // 40° from centre to the window edge (as in the prototype)
const YAW_PX = 3; // px per degree on the calibration tape
const TAPE_Y = SIZE + 10;

let uid = 0;

export function createAttitude(container, { tape = false } = {}) {
	const id = `att${++uid}`;
	const horizon = s("g");
	const rollPointer = s("g");
	const tapeTicks = s("g");
	const yawRangeBar = s("rect", { class: "att-range-box", x: 0, y: TAPE_Y + 1, width: 0, height: 26, visibility: "hidden" });
	const pitchArc = s("path", { class: "att-range", d: "", visibility: "hidden" });
	const pitchMarker = s("circle", { r: 3.5, class: "att-roll-pointer", visibility: "hidden" });

	// --- horizon: sky and ground in two ink tones, bone horizon, ladder every 10°
	horizon.append(
		s("rect", { class: "att-sky", x: CX - 2 * r, y: CY - 2 * r, width: 4 * r, height: 2 * r }),
		s("rect", { class: "att-ground", x: CX - 2 * r, y: CY, width: 4 * r, height: 2 * r }),
		s("line", { class: "att-horizon", x1: CX - 2 * r, y1: CY, x2: CX + 2 * r, y2: CY }),
	);
	const ladder = s("g", { class: "att-ladder" });
	for (let d = -30; d <= 30; d += 10) {
		if (!d) continue;
		const y = CY - d * PITCH_PX;
		const w = d % 20 === 0 ? r * 0.34 : r * 0.2;
		ladder.append(
			s("line", { x1: CX - w / 2, y1: y, x2: CX + w / 2, y2: y }),
			s("text", { x: CX + w / 2 + 6, y, "dominant-baseline": "middle" }, String(Math.abs(d))),
		);
	}
	horizon.append(ladder);

	// --- bezel ticks every 10° of roll, long ticks every 30°
	const ticks = s("g", { class: "att-ticks" });
	for (let i = -6; i <= 6; i++) {
		const a = -Math.PI / 2 + i * Math.PI / 18;
		const major = i % 3 === 0;
		const len = major ? 10 : 5;
		ticks.append(s("line", {
			class: major ? "major" : "",
			x1: CX + Math.cos(a) * R, y1: CY + Math.sin(a) * R,
			x2: CX + Math.cos(a) * (R - len), y2: CY + Math.sin(a) * (R - len),
		}));
	}
	rollPointer.append(s("path", { class: "att-roll-pointer", d: `M${CX} ${CY - r + 2} l-6 10 h12 z` }));

	// --- optional heading tape (calibration: yaw range)
	if (tape) {
		for (let d = -120; d <= 120; d += 5) {
			const x = CX + d * YAW_PX;
			const major = d % 15 === 0;
			tapeTicks.append(s("line", { x1: x, y1: TAPE_Y + 28, x2: x, y2: TAPE_Y + (major ? 17 : 22), "stroke-width": major ? 1.2 : 1 }));
			if (major && d % 30 === 0) {
				tapeTicks.append(s("text", { x, y: TAPE_Y + 12, "text-anchor": "middle" }, d === 0 ? "0" : `${d > 0 ? "R" : "L"}${Math.abs(d)}`));
			}
		}
	}

	const height = tape ? TAPE_Y + 32 : SIZE;
	const svg = s("svg", { viewBox: `0 0 ${SIZE} ${height}`, class: "att-dial", role: "img", "aria-label": "Head attitude indicator" },
		s("defs", {},
			s("clipPath", { id: `${id}-clip` }, s("circle", { cx: CX, cy: CY, r })),
			s("clipPath", { id: `${id}-tape` }, s("rect", { x: 20, y: TAPE_Y, width: 200, height: 28, rx: 8 })),
		),
		ticks,
		s("g", { "clip-path": `url(#${id}-clip)` }, horizon),
		s("circle", { class: "att-window", cx: CX, cy: CY, r }),
		pitchArc,
		pitchMarker,
		// Fixed "aircraft" (your head) symbol
		s("path", { class: "att-aircraft", d: `M${CX - r * 0.42} ${CY} H${CX - r * 0.12} L${CX} ${CY + r * 0.08} L${CX + r * 0.12} ${CY} H${CX + r * 0.42}` }),
		rollPointer,
		tape ? s("g", { class: "att-heading" },
			s("rect", { class: "tape", x: 20, y: TAPE_Y, width: 200, height: 28, rx: 8 }),
			s("g", { "clip-path": `url(#${id}-tape)` }, yawRangeBar, tapeTicks),
			s("path", { class: "index", d: `M${CX} ${TAPE_Y + 2} l-5 -9 h10 z` }),
			s("line", { x1: CX, y1: TAPE_Y + 2, x2: CX, y2: TAPE_Y + 26, stroke: "var(--ember)", "stroke-width": 1.5 }),
		) : null,
	);

	const readout = (label) => {
		const value = h("div", { class: "dot-num att-trio__v" }, "--");
		return { el: h("div", {}, h("div", { class: "label" }, label), value), value };
	};
	const pitchOut = readout("Pitch");
	const rollOut = readout("Roll");
	const yawOut = readout("Yaw");
	container.replaceChildren(
		h("div", { class: "att-dial-wrap" }, svg),
		h("div", { class: "att-trio" }, pitchOut.el, rollOut.el, yawOut.el),
	);

	let last = { pitch: Infinity, roll: Infinity, yaw: Infinity }; // forces the first write

	function arcPath(radius, a0, a1) {
		const p0 = [CX + radius * Math.cos(a0), CY + radius * Math.sin(a0)];
		const p1 = [CX + radius * Math.cos(a1), CY + radius * Math.sin(a1)];
		const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
		const sweep = a1 > a0 ? 1 : 0;
		return `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)} A${radius} ${radius} 0 ${large} ${sweep} ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`;
	}
	// Pitch shown on the left bezel: up = higher on the arc.
	const pitchAngle = (deg) => Math.PI + Math.max(-60, Math.min(60, deg)) * Math.PI / 180 * 1.2;

	return {
		/** @param {{pitch:number, roll:number, yaw:number}} pose degrees (engine convention) */
		update(pose) {
			if (!pose) return;
			// User's perspective: yaw right positive (engine yaw is positive to the left).
			const pitch = Math.max(-45, Math.min(45, pose.pitch));
			const roll = pose.roll;
			const yaw = -pose.yaw;
			if (Math.abs(pitch - last.pitch) > 0.05 || Math.abs(roll - last.roll) > 0.05) {
				horizon.setAttribute("transform", `rotate(${roll.toFixed(2)} ${CX} ${CY}) translate(0 ${(pitch * PITCH_PX).toFixed(2)})`);
				rollPointer.setAttribute("transform", `rotate(${roll.toFixed(2)} ${CX} ${CY})`);
			}
			if (tape && Math.abs(yaw - last.yaw) > 0.05) {
				const shift = (-yaw * YAW_PX).toFixed(2);
				tapeTicks.setAttribute("transform", `translate(${shift} 0)`);
				yawRangeBar.setAttribute("transform", `translate(${shift} 0)`);
			}
			last = { pitch, roll, yaw };
			setText(pitchOut.value, `${signed(pitch)}°`);
			setText(rollOut.value, `${signed(roll)}°`);
			setText(yawOut.value, `${signed(yaw)}°`);
		},
		/** Calibration: draw the measured comfortable range (degrees, user perspective). */
		setRange(range) {
			if (!range) {
				yawRangeBar.setAttribute("visibility", "hidden");
				pitchArc.setAttribute("visibility", "hidden");
				pitchMarker.setAttribute("visibility", "hidden");
				return;
			}
			const { yawMin, yawMax, pitchMin, pitchMax, pitchNow } = range;
			if (tape && Number.isFinite(yawMin) && Number.isFinite(yawMax)) {
				yawRangeBar.setAttribute("visibility", "visible");
				yawRangeBar.setAttribute("x", (CX + yawMin * YAW_PX).toFixed(1));
				yawRangeBar.setAttribute("width", Math.max(0, (yawMax - yawMin) * YAW_PX).toFixed(1));
			}
			if (Number.isFinite(pitchMin) && Number.isFinite(pitchMax)) {
				pitchArc.setAttribute("visibility", "visible");
				pitchArc.setAttribute("d", arcPath(R + 1, pitchAngle(pitchMax), pitchAngle(pitchMin)));
			}
			if (Number.isFinite(pitchNow)) {
				const a = pitchAngle(pitchNow);
				pitchMarker.setAttribute("visibility", "visible");
				pitchMarker.setAttribute("cx", (CX + (R + 1) * Math.cos(a)).toFixed(1));
				pitchMarker.setAttribute("cy", (CY + (R + 1) * Math.sin(a)).toFixed(1));
			}
		},
	};
}
