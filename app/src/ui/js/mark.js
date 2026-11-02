// The live VISION mark: a Landolt C (the ring optometrists use to test sight).
// The gap is VISION's focus. Plain-JS port of design-ref/vision-mark.js (geometry and
// behaviour unchanged), plus reduced-motion handling.
//
//   const mark = new Mark("idle");     // idle | listening | thinking | speaking | acting | error | offline
//   mark.set("acting");                // acting / error retrigger their animation
//   each frame: mark.update(dtSeconds, timeSeconds, level0to1); mark.draw(canvas, cssSizePx, { bone, ember, dim });

const TAU = Math.PI * 2;
const adiff = (a, b) => {
	let d = (a - b) % TAU;
	if (d > Math.PI) d -= TAU;
	if (d < -Math.PI) d += TAU;
	return d;
};
const DIRS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => -Math.PI / 2 + i * Math.PI / 4);
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export class Mark {
	constructor(state) {
		this.s = state || "idle";
		this.g = 0.5;
		this.gv = 0;
		this.th = -Math.PI / 4;
		this.th2 = Math.PI * 0.75;
		this.spin = 0;
		this.vol = 0;
		this.flash = 0;
		this.shake = 0;
		this.snap = -9e9;
		this.inA = 0;
		this.errDir = 0;
		this.errT = 0;
		this.chartT = 0;
		this.chartI = 0;
		this.ripple = 0;
		this.off = 0;
	}

	set(state) {
		if (state === "acting") {
			this.snap = performance.now();
			this.flash = 1;
			this.ripple = 1;
		}
		if (state === "error") {
			this.shake = 1;
		}
		this.s = state;
	}

	update(dt, t, vol) {
		const reduce = reducedMotion();
		if (reduce) t = 0; // no breathing, no chart stepping
		const s = this.s;
		const now = performance.now();
		this.vol = vol;
		let g = { idle: 0.62 + Math.sin(t * 1.3) * 0.05, listening: 0.78 + vol * 0.3, thinking: 0.52, speaking: 0.5 + vol * 0.75, acting: 0.62, error: 0.5, offline: 0.5 }[s];
		if (s === "acting" && now - this.snap < 320) g = 0;
		this.gv += (g - this.g) * 0.18;
		this.gv *= 0.68;
		this.g = Math.max(0, this.g + this.gv);
		let th;
		if (s === "thinking") {
			th = DIRS[this.chartI];
		} else if (s === "error") {
			// The gap jumps between directions: "look at the camera".
			const nowS = now / 1000;
			if (!reduce && nowS - this.errT > 0.42) {
				this.errT = nowS;
				this.errDir = (this.errDir + 3 + Math.floor(Math.random() * 3)) % 8;
			}
			th = DIRS[this.errDir];
		} else {
			this.spin = this.th + Math.PI / 2;
			th = { idle: -Math.PI / 4, listening: -Math.PI / 2, speaking: -Math.PI / 2, acting: this.th, offline: Math.PI / 2 }[s];
		}
		this.th += adiff(th, this.th) * (s === "error" || s === "thinking" ? 0.3 : 0.12);
		const nowS = now / 1000;
		if (s === "thinking" && !reduce && nowS - this.chartT > 0.34) {
			this.chartT = nowS;
			this.chartI = (this.chartI + 1) % 8;
		}
		const th2T = s === "thinking" ? DIRS[(this.chartI * 3) % 8] : this.th + Math.PI;
		this.th2 += adiff(th2T, this.th2) * 0.3;
		this.inA += (0 - this.inA) * 0.12;
		this.off += ((s === "offline" ? 1 : 0) - this.off) * 0.1;
		this.flash = Math.max(0, this.flash - dt * 1.3);
		this.shake = reduce ? 0 : Math.max(0, this.shake - dt * 1.2);
		this.ripple = Math.max(0, this.ripple - dt * 1.1);
	}

	draw(canvas, S, { bone, ember, dim }) {
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		const size = Math.round(S * dpr);
		if (canvas.width !== size || canvas.height !== size) {
			canvas.width = size;
			canvas.height = size;
		}
		const ctx = canvas.getContext("2d");
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, S, S);
		const R = S / 2;
		const t = performance.now() / 1000;
		const small = S < 64;
		ctx.save();
		ctx.translate(R + (this.shake ? Math.sin(t * 60) * this.shake * R * 0.04 : 0), R);
		const r = R * 0.62;
		const w = R * (small ? 0.26 : 0.22);
		const live = (this.s === "listening" || this.s === "speaking") ? this.vol : 0;
		const ha = Math.min(1.2, this.g * 0.62);
		// acting ripple
		if (this.ripple > 0) {
			ctx.beginPath();
			ctx.arc(0, 0, r + w * 0.5 + (1 - this.ripple) * R * 0.28, 0, TAU);
			ctx.strokeStyle = ember;
			ctx.globalAlpha = this.ripple * 0.8;
			ctx.lineWidth = Math.max(1, R * 0.02);
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
		// outer C as a band whose thickness carries the level
		const N = small ? 90 : 200;
		const a0 = this.th + ha;
		const span = TAU - 2 * ha;
		const outer = [];
		const inner = [];
		for (let k = 0; k <= N; k++) {
			const p = a0 + span * k / N;
			const m = live ? live * 0.42 * (0.5 + 0.5 * Math.sin(p * 4 + t * 7)) * (0.7 + 0.3 * Math.sin(p * 2 - t * 4.3)) : 0;
			const ww = w * (1 + m);
			outer.push([Math.cos(p) * (r + ww / 2), Math.sin(p) * (r + ww / 2)]);
			inner.push([Math.cos(p) * (r - ww / 2), Math.sin(p) * (r - ww / 2)]);
		}
		ctx.beginPath();
		outer.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
		for (let i = inner.length - 1; i >= 0; i--) ctx.lineTo(inner[i][0], inner[i][1]);
		ctx.closePath();
		if (this.off > 0.5) {
			ctx.setLineDash([R * 0.05, R * 0.05]);
			ctx.strokeStyle = dim;
			ctx.lineWidth = Math.max(1, R * 0.018);
			ctx.stroke();
			ctx.setLineDash([]);
		} else {
			ctx.fillStyle = this.s === "error" ? ember : bone;
			ctx.fill();
			if (this.flash > 0) {
				ctx.globalAlpha = this.flash;
				ctx.fillStyle = ember;
				ctx.fill();
				ctx.globalAlpha = 1;
			}
		}
		// inner C (the smaller row of the chart)
		if (this.inA > 0.02 && !small) {
			const r2 = R * 0.28, w2 = R * 0.1, h2 = 0.42;
			ctx.beginPath();
			ctx.arc(0, 0, r2 + w2 / 2, this.th2 + h2, this.th2 + TAU - h2);
			ctx.arc(0, 0, r2 - w2 / 2, this.th2 + TAU - h2, this.th2 + h2, true);
			ctx.closePath();
			ctx.globalAlpha = this.inA;
			ctx.fillStyle = bone;
			ctx.fill();
			ctx.globalAlpha = 1;
		}
		// focus point sits in the gap
		const dA = Math.min(1, this.g * 2.2) * (1 - this.off);
		if (dA > 0.02) {
			const dr = R * (small ? 0.1 : 0.075) * (1 + live * 0.9) * (this.s === "error" ? 1.3 : 1);
			ctx.beginPath();
			ctx.arc(Math.cos(this.th) * r, Math.sin(this.th) * r, dr, 0, TAU);
			ctx.globalAlpha = dA;
			ctx.fillStyle = ember;
			ctx.fill();
			ctx.globalAlpha = 1;
		}
		// centre crosshair, only at large sizes and at rest
		if (!small && this.inA < 0.5) {
			const k = R * 0.05;
			ctx.strokeStyle = dim;
			ctx.globalAlpha = 1 - this.inA * 2;
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(-k, 0);
			ctx.lineTo(k, 0);
			ctx.moveTo(0, -k);
			ctx.lineTo(0, k);
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
		ctx.restore();
	}
}

/**
 * Engine state -> mark state (no new engine events needed).
 * @returns {{state: string, level: number}}
 */
export function markStateFor(engineState, { calibrating = false } = {}) {
	if (calibrating || engineState.status === "starting") return { state: "thinking", level: 0 };
	if (engineState.paused) return { state: "offline", level: 0 };
	if (engineState.status === "camera-error" || engineState.status === "no-face" || engineState.framing?.ok === false) {
		return { state: "error", level: 0 };
	}
	const g = engineState.gestures;
	if (g?.scroll) {
		const level = Math.max(0, Math.min(1, (g.mouth?.ratio ?? 0) / 0.7));
		return { state: "listening", level };
	}
	return { state: "idle", level: 0 };
}
