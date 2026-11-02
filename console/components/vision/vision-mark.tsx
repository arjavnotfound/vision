'use client';

import { memo, useEffect, useRef } from 'react';
import type { MotionValue } from 'motion/react';
import { cn } from '@/lib/shadcn/utils';
import { useReducedMotionPref } from './appearance-root';

export type MarkState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'acting'
  | 'error'
  | 'offline';

export interface VisionMarkProps {
  /** Rendered size in CSS px. Below 64px the band is drawn thicker. */
  size: number;
  state: MarkState;
  /** 0..1 microphone level (listening). */
  micLevel?: MotionValue<number>;
  /** 0..1 agent output level (speaking). */
  outputLevel?: MotionValue<number>;
  /** Increment to retrigger the acting snap (one per action_start). */
  actionPulse?: number;
  /** Increment to retrigger the error shake. */
  errorPulse?: number;
  /** Freeze motion at a representative pose (still captures). */
  still?: boolean;
  className?: string;
}

/* The VISION mark: a Landolt C, the ring optometrists use to test sight.
   The gap is where VISION is looking, and its mouth.
   Geometry on a 100-unit box: ring outer radius 40, inner radius 24,
   parallel-sided gap 16 wide, ember point in the gap.
   Behaviour is ported from design-ref/vision-mark.js. */

const TAU = Math.PI * 2;
const DIRS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => -Math.PI / 2 + (i * Math.PI) / 4);
const adiff = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

const OUTER = 0.8; // ×R  (40 / 50)
const INNER = 0.48; // ×R (24 / 50)
const INNER_SMALL = 0.42; // thicker band below 64px
const GAP_HALF = 0.16; // ×R (16-wide gap → half-width 8 / 50) at the resting gap value
const REST_G = 0.62;

const BASE_G: Record<MarkState, number> = {
  idle: 0.62,
  listening: 0.78,
  thinking: 0.52,
  speaking: 0.5,
  acting: 0.62,
  error: 0.5,
  offline: 0.5,
};
const FACING: Partial<Record<MarkState, number>> = {
  idle: -Math.PI / 4,
  listening: -Math.PI / 2,
  speaking: -Math.PI / 2,
  offline: Math.PI / 2,
};

interface Sim {
  g: number;
  gv: number;
  th: number;
  vol: number;
  flash: number;
  shake: number;
  snap: number;
  ripple: number;
  off: number;
  errDir: number;
  errT: number;
  chartT: number;
  chartI: number;
}

interface Colors {
  bone: string;
  ember: string;
  dim: string;
}

function readColors(el: Element): Colors {
  const css = getComputedStyle(el);
  return {
    bone: css.getPropertyValue('--bone').trim() || '#f2ede4',
    ember: css.getPropertyValue('--ember').trim() || '#ff5a1f',
    dim: css.getPropertyValue('--bone-3').trim() || '#8a847a',
  };
}

function VisionMarkImpl({
  size,
  state,
  micLevel,
  outputLevel,
  actionPulse = 0,
  errorPulse = 0,
  still = false,
  className,
}: VisionMarkProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotionPref();
  const sim = useRef<Sim>({
    g: BASE_G[state],
    gv: 0,
    th: FACING[state] ?? -Math.PI / 4,
    vol: 0,
    flash: 0,
    shake: 0,
    snap: -9e9,
    ripple: 0,
    off: state === 'offline' ? 1 : 0,
    errDir: 0,
    errT: 0,
    chartT: 0,
    chartI: 0,
  });

  // Props the loop reads without restarting.
  const live = useRef({ state, micLevel, outputLevel, reduced, still, size });
  live.current = { state, micLevel, outputLevel, reduced, still, size };

  // Acting: retrigger on every action and when entering the acting state.
  const firstAction = useRef(actionPulse);
  useEffect(() => {
    if (actionPulse === firstAction.current && state !== 'acting') return;
    const s = sim.current;
    s.snap = performance.now();
    s.flash = 1;
    s.ripple = 1;
  }, [actionPulse, state]);

  const firstError = useRef(errorPulse);
  useEffect(() => {
    if (errorPulse === firstError.current && state !== 'error') return;
    if (!live.current.reduced) sim.current.shake = 1;
  }, [errorPulse, state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    let colors = readColors(canvas);
    let frame = 0;

    const tick = (nowMs: number) => {
      raf = requestAnimationFrame(tick);
      const {
        state: st,
        micLevel: mic,
        outputLevel: out,
        reduced: rm,
        still: frozen,
        size: S,
      } = live.current;
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      const t = frozen ? 1.2 : nowMs / 1000;
      if (frame++ % 30 === 0) colors = readColors(canvas);

      // Backing store follows DPR and size.
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const px = Math.round(S * dpr);
      if (canvas.width !== px) {
        canvas.width = px;
        canvas.height = px;
      }

      // ---------------- update ----------------
      const s = sim.current;
      const level =
        st === 'listening'
          ? frozen
            ? 0.45
            : (mic?.get() ?? 0)
          : st === 'speaking'
            ? frozen
              ? 0.5
              : (out?.get() ?? 0)
            : 0;
      s.vol = Math.min(1, Math.max(0, level));

      let g = BASE_G[st];
      if (st === 'idle' && !frozen) g = 0.62 + Math.sin(t * 1.3) * 0.05;
      if (st === 'listening') g = 0.78 + s.vol * 0.3;
      if (st === 'speaking') g = 0.5 + s.vol * 0.75;
      if (nowMs - s.snap < 320) g = 0;

      // Frame-rate independent version of the reference spring (tuned at 60fps).
      const steps = Math.max(1, Math.min(4, Math.round(dt * 60)));
      for (let i = 0; i < steps; i++) {
        s.gv += (g - s.g) * 0.18;
        s.gv *= 0.68;
        s.g = Math.max(0, s.g + s.gv);
      }
      if (frozen) s.g = g;

      let th: number;
      if (st === 'thinking') {
        const stepEvery = rm ? 1 : 0.34;
        if (t - s.chartT > stepEvery) {
          s.chartT = t;
          s.chartI = (s.chartI + 1) % 8;
        }
        th = DIRS[s.chartI];
      } else if (st === 'error') {
        if (t - s.errT > 0.42) {
          s.errT = t;
          s.errDir = (s.errDir + 3 + Math.floor(Math.random() * 3)) % 8;
        }
        th = DIRS[s.errDir];
      } else {
        th = FACING[st] ?? s.th;
      }
      if (rm || frozen) s.th = th;
      else {
        const k = st === 'error' || st === 'thinking' ? 0.3 : 0.12;
        for (let i = 0; i < steps; i++) s.th += adiff(th, s.th) * k;
      }

      for (let i = 0; i < steps; i++) s.off += ((st === 'offline' ? 1 : 0) - s.off) * 0.1;
      if (frozen) s.off = st === 'offline' ? 1 : 0;
      s.flash = Math.max(0, s.flash - dt * 1.3);
      s.shake = rm ? 0 : Math.max(0, s.shake - dt * 1.2);
      s.ripple = Math.max(0, s.ripple - dt * 1.1);

      // ---------------- draw ----------------
      const R = S / 2;
      const small = S < 64;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, S, S);
      ctx.save();
      ctx.translate(R + (s.shake ? Math.sin(t * 60) * s.shake * R * 0.04 : 0), R);

      const ro = R * OUTER;
      const ri = R * (small ? INNER_SMALL : INNER);
      const rm2 = (ro + ri) / 2;
      const w = ro - ri;
      const liveV = st === 'listening' || st === 'speaking' ? s.vol : 0;
      // Parallel-sided gap: half-width in px, scaled by the gap value.
      const hw = Math.min(ri * 0.98, R * GAP_HALF * (s.g / REST_G));

      if (s.ripple > 0) {
        ctx.beginPath();
        // Stays inside the canvas (ring at 0.8R, ripple up to ~0.98R).
        ctx.arc(0, 0, ro + (1 - s.ripple) * R * 0.17, 0, TAU);
        ctx.strokeStyle = colors.ember;
        ctx.globalAlpha = s.ripple * 0.8;
        ctx.lineWidth = Math.max(1, R * 0.02);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // The C as a band whose thickness carries the voice.
      const N = small ? 90 : 200;
      const mod = (p: number) =>
        liveV
          ? liveV *
            0.42 *
            (0.5 + 0.5 * Math.sin(p * 4 + t * 7)) *
            (0.7 + 0.3 * Math.sin(p * 2 - t * 4.3))
          : 0;
      const edge = (radius: number) => (hw > 0.01 ? Math.asin(Math.min(0.999, hw / radius)) : 0);
      ctx.beginPath();
      // outer edge, gap → around → gap
      {
        const a0 = s.th + edge(ro);
        const span = TAU - 2 * edge(ro);
        for (let k = 0; k <= N; k++) {
          const p = a0 + (span * k) / N;
          const ww = (w / 2) * (1 + mod(p));
          const x = Math.cos(p) * (rm2 + ww);
          const y = Math.sin(p) * (rm2 + ww);
          if (k) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
      }
      // inner edge back
      {
        const a0 = s.th + edge(ri);
        const span = TAU - 2 * edge(ri);
        for (let k = N; k >= 0; k--) {
          const p = a0 + (span * k) / N;
          const ww = (w / 2) * (1 + mod(p));
          ctx.lineTo(Math.cos(p) * Math.max(0, rm2 - ww), Math.sin(p) * Math.max(0, rm2 - ww));
        }
      }
      ctx.closePath();

      if (s.off > 0.5) {
        ctx.setLineDash([R * 0.05, R * 0.05]);
        ctx.strokeStyle = colors.dim;
        ctx.lineWidth = Math.max(1, R * 0.018);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = st === 'error' ? colors.ember : colors.bone;
        ctx.globalAlpha = 1 - s.off;
        ctx.fill();
        if (s.flash > 0) {
          ctx.globalAlpha = s.flash;
          ctx.fillStyle = colors.ember;
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // Ember focus point, sitting in the gap.
      const dA = Math.min(1, s.g * 2.2) * (1 - s.off);
      if (dA > 0.02) {
        const dr = R * (small ? 0.1 : 0.075) * (1 + liveV * 0.9) * (st === 'error' ? 1.3 : 1);
        ctx.beginPath();
        ctx.arc(Math.cos(s.th) * rm2, Math.sin(s.th) * rm2, dr, 0, TAU);
        ctx.globalAlpha = dA;
        ctx.fillStyle = colors.ember;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Centre crosshair, large sizes only.
      if (!small) {
        const k = R * 0.05;
        ctx.strokeStyle = colors.dim;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-k, 0);
        ctx.lineTo(k, 0);
        ctx.moveTo(0, -k);
        ctx.lineTo(0, k);
        ctx.stroke();
      }
      ctx.restore();
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn('block shrink-0', className)}
      style={{ width: size, height: size }}
    />
  );
}

export const VisionMark = memo(VisionMarkImpl);

/** Static logo mark (no canvas) for headers: the Landolt C with the ember point. */
export function StaticMark({ size = 24, className }: { size?: number; className?: string }) {
  // Gap faces upper-right (−45°): rectangle masked out of the ring, as in the logo.
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden
      className={cn('block shrink-0', className)}
    >
      <path fillRule="evenodd" style={{ fill: 'var(--bone)' }} d={staticRingPath()} />
      <circle
        cx={50 + Math.cos(-Math.PI / 4) * 32}
        cy={50 + Math.sin(-Math.PI / 4) * 32}
        r={7.5}
        style={{ fill: 'var(--ember)' }}
      />
    </svg>
  );
}

function staticRingPath() {
  const th = -Math.PI / 4;
  const hw = 8;
  const pt = (r: number, a: number) =>
    `${(50 + Math.cos(a) * r).toFixed(2)} ${(50 + Math.sin(a) * r).toFixed(2)}`;
  const ao = Math.asin(hw / 40);
  const ai = Math.asin(hw / 24);
  return (
    `M${pt(40, th + ao)}` +
    `A40 40 0 1 1 ${pt(40, th - ao)}` +
    `L${pt(24, th - ai)}` +
    `A24 24 0 1 0 ${pt(24, th + ai)}Z`
  );
}
