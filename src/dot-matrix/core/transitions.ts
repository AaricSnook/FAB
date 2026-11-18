import { CYCLE_CHARS, GLYPH_H, GLYPH_W, getGlyph } from './font';
import type { Cell } from './layout';

export interface TransitionContext {
  cols: number;
  rows: number;
  /** What was on screen when the transition started. */
  from: Float32Array;
  /** The target frame. */
  to: Float32Array;
  /** Where the target's characters sit (for per-character effects). */
  toCells: Cell[];
  /** Linear progress, 0 → 1. */
  t: number;
  /** Milliseconds since the transition started (drives flicker). */
  time: number;
  /** Changes on every transition so random effects never repeat exactly. */
  seed: number;
  out: Float32Array;
  /**
   * How far each dot's disc faces the viewer: 1 is face-on, 0 is edge-on.
   * Starts at 1 for every dot; only physical transitions (flipdot) change it.
   */
  spin: Float32Array;
}

export type TransitionFn = (c: TransitionContext) => void;

/* ---------- helpers ---------- */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Deterministic hash → [0, 1). Same inputs always give the same "random" value. */
export function hash(a: number, b = 0): number {
  let x = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b | 0, 0xc2b2ae35);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

/* ---------- transitions ---------- */

const none: TransitionFn = ({ to, out }) => out.set(to);

/** Crossfade, sweeping slightly left to right. */
const fade: TransitionFn = ({ cols, rows, from, to, t, out }) => {
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const local = clamp01((t - (x / Math.max(1, cols)) * 0.35) / 0.65);
      out[i] = lerp(from[i], to[i], easeInOut(local));
    }
};

/** A bright scan line sweeps across, swapping each column as it passes. */
const wipe: TransitionFn = ({ cols, rows, from, to, t, out }) => {
  const edge = easeInOut(t) * (cols + 6) - 3;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const base = x < edge ? to[i] : from[i];
      const glow = clamp01(1 - Math.abs(x - edge) / 1.5) * 0.55;
      out[i] = Math.max(base, glow);
    }
};

/** Dots flicker randomly, then each one locks onto its final state. */
const scramble: TransitionFn = ({ cols, rows, from, to, t, time, seed, out }) => {
  const tick = Math.floor(time / 45);
  for (let i = 0; i < cols * rows; i++) {
    const start = hash(i, seed) * 0.3;
    const settle = 0.35 + hash(i, seed + 1) * 0.6;
    if (t < start) out[i] = from[i];
    else if (t >= settle) out[i] = to[i];
    else out[i] = hash(i, seed + tick) > 0.62 ? 1 : 0;
  }
};

/** Split-flap board: each character cycles through glyphs, landing left to right. */
const flip: TransitionFn = ({ cols, rows, from, to, toCells, t, time, seed, out }) => {
  // Dots outside any character cell just fade.
  for (let i = 0; i < cols * rows; i++) out[i] = lerp(from[i], to[i], easeInOut(t));
  const n = toCells.length;
  const tick = Math.floor(time / 70);
  toCells.forEach((cell, k) => {
    const settle = 0.3 + 0.65 * (n > 1 ? k / (n - 1) : 1);
    const start = Math.max(0, settle - 0.4);
    let glyph: Uint8Array | null = null;
    let source: Float32Array | null = null;
    if (t >= settle) source = to;
    else if (t < start) source = from;
    else if (cell.ch === ' ') source = to;
    else glyph = getGlyph(CYCLE_CHARS[Math.floor(hash(k + seed * 31, tick) * CYCLE_CHARS.length)]);
    for (let gy = 0; gy < GLYPH_H; gy++) {
      const y = cell.y + gy;
      if (y < 0 || y >= rows) continue;
      for (let gx = 0; gx < GLYPH_W; gx++) {
        const x = cell.x + gx;
        if (x < 0 || x >= cols) continue;
        const i = y * cols + x;
        out[i] = glyph ? glyph[gy * GLYPH_W + gx] * 0.85 : source![i];
      }
    }
  });
};

/** Columns drop in from the top at staggered times, each with a bright leading dot. */
const rain: TransitionFn = ({ cols, rows, from, to, t, seed, out }) => {
  for (let x = 0; x < cols; x++) {
    const delay = hash(x, seed) * 0.45;
    for (let y = 0; y < rows; y++) {
      const i = y * cols + x;
      const th = delay + (y / Math.max(1, rows)) * 0.45;
      const since = t - th;
      out[i] = since < 0 ? from[i] : since < 0.05 ? 1 : to[i];
    }
  }
};

/** A ring spreads out from the centre, swapping dots as it passes. */
const ripple: TransitionFn = ({ cols, rows, from, to, t, out }) => {
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  // Use x-distance scaled so wide displays still ripple evenly.
  const maxD = Math.hypot(cx, cy * 1.5) || 1;
  const front = easeOut(t) * 1.15;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const d = Math.hypot(x - cx, (y - cy) * 1.5) / maxD;
      const base = d < front ? to[i] : from[i];
      const ring = clamp01(1 - Math.abs(d - front) / 0.06) * 0.6;
      out[i] = Math.max(base, ring);
    }
};

/**
 * Damped spring for a magnetic disc: shoots past 180°, settles back.
 * Returns progress where 1 = fully turned; peaks around 1.13.
 */
const snap = (u: number) => 1 - Math.exp(-7 * u) * Math.cos(11 * u);

/**
 * Flip-dot sign: each dot is a two-sided disc. Only dots that change turn over,
 * sweeping left to right with slight jitter, and snap into place with a small bounce.
 */
const flipdot: TransitionFn = ({ cols, rows, from, to, t, seed, out, spin }) => {
  const turn = 0.32; // share of the duration one disc takes to flip and settle
  const sweep = 1 - turn - 0.08;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const a = from[i] >= 0.5 ? 1 : 0;
      const b = to[i] >= 0.5 ? 1 : 0;
      if (a === b) {
        out[i] = b;
        spin[i] = 1;
        continue;
      }
      // Columns fire in order, like a sign's driver scanning across; each coil is a touch late or early.
      const start = (x / Math.max(1, cols - 1)) * sweep + hash(i, seed) * 0.08;
      const u = clamp01((t - start) / turn);
      const angle = Math.PI * (u === 1 ? 1 : snap(u)); // 0 → π, with overshoot
      out[i] = angle < Math.PI / 2 ? a : b;
      spin[i] = Math.abs(Math.cos(angle));
    }
};

export const transitions = { none, fade, wipe, scramble, flip, flipdot, rain, ripple } satisfies Record<string, TransitionFn>;

/** `count` is handled by the controller: it tweens the number itself, then draws each step. */
export type TransitionName = keyof typeof transitions | 'count';
export const TRANSITION_NAMES: TransitionName[] = ['flipdot', 'flip', 'scramble', 'fade', 'wipe', 'rain', 'ripple', 'count', 'none'];
