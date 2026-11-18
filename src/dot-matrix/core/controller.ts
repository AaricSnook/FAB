import { type Bitmap, type Cell, type Frame, type LayoutOptions, layout, measure, placeBitmap, resize } from './layout';
import { type TransitionFn, type TransitionName, easeInOut, transitions } from './transitions';

export type DotShape = 'circle' | 'square' | 'rounded';

/**
 * How dots are arranged.
 * - `grid`: rows and columns.
 * - `circle`: a square grid cropped to a round face.
 */
export type MatrixLayout = 'grid' | 'circle';

export interface DotMatrixOptions extends LayoutOptions {
  /** Dot diameter in CSS pixels. */
  dotSize: number;
  /** Space between dots in CSS pixels. */
  gap: number;
  shape: DotShape;
  layout: MatrixLayout;
  /** Lit dot colour. Defaults to the canvas's CSS `color`, so it follows your theme. */
  color?: string;
  /** Unlit dot colour. Defaults to `color` at `offOpacity`. */
  offColor?: string;
  /** Opacity of unlit dots: applies to `offColor` too. */
  offOpacity: number;
  /** Bloom around lit dots, 0 (none) to 1. */
  glow: number;
  /** Fix the grid size in dots. The circle layout uses `cols` as the diameter. */
  cols?: number;
  rows?: number;
  transition: TransitionName;
  /** Transition length in ms. */
  duration: number;
  /** Scroll text that is wider than `cols`. Needs `cols` to be set. */
  marquee: boolean;
  /** Marquee speed in dots per second. */
  marqueeSpeed: number;
  /** Blank columns between marquee repeats. */
  marqueeGap: number;
  /** `auto` follows the OS setting; `reduce` always skips motion. */
  reducedMotion: 'auto' | 'reduce' | 'no-preference';
}

export const defaultOptions: DotMatrixOptions = {
  dotSize: 6,
  gap: 2,
  shape: 'circle',
  layout: 'grid',
  offOpacity: 0.1,
  glow: 0,
  letterSpacing: 1,
  lineSpacing: 2,
  align: 'left',
  vAlign: 'middle',
  padding: 0,
  transition: 'scramble',
  duration: 900,
  marquee: false,
  marqueeSpeed: 14,
  marqueeGap: 8,
  reducedMotion: 'auto',
};

/** What the display is showing. */
type Content = { kind: 'text'; text: string } | { kind: 'bitmap'; bitmap: Bitmap };

type Anim =
  | { kind: 'dots'; fn: TransitionFn; from: Float32Array; to: Float32Array; cells: Cell[]; seed: number; start: number; duration: number; final: Frame }
  | { kind: 'count'; a: ParsedNumber; b: ParsedNumber; start: number; duration: number; final: Frame };

/** Where each physical dot sits, and which grid cell it shows. */
interface Geometry {
  x: Float32Array;
  y: Float32Array;
  cell: Int32Array;
  width: number;
  height: number;
  /** Every dot as one path, for the unlit layer. */
  all: Path2D;
}

interface ParsedNumber {
  prefix: string;
  value: number;
  suffix: string;
  decimals: number;
  commas: boolean;
}

const NUMBER = /^(.*?)(-?\d[\d,]*(?:\.\d+)?)(\D*)$/;

function parseNumber(text: string): ParsedNumber | null {
  const m = NUMBER.exec(text);
  if (!m) return null;
  const digits = m[2];
  const dot = digits.indexOf('.');
  return {
    prefix: m[1],
    value: Number(digits.replace(/,/g, '')),
    suffix: m[3],
    decimals: dot === -1 ? 0 : digits.length - dot - 1,
    commas: digits.includes(','),
  };
}

function formatNumber(v: number, like: ParsedNumber) {
  let s = v.toFixed(like.decimals);
  if (like.commas) {
    const [int, frac] = s.split('.');
    s = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? '.' + frac : '');
  }
  return like.prefix + s + like.suffix;
}

const LEVELS = 12;

/**
 * Framework-free dot-matrix display drawn on a canvas.
 * Content (text or a bitmap) is laid out on a grid; transitions animate that grid;
 * a geometry maps the grid onto physical dots, so the same content can show on a
 * rectangle or a round face.
 * The React component wraps this; a Figma plugin or another framework can use it directly.
 */
export class DotMatrixController {
  private ctx: CanvasRenderingContext2D;
  private o: DotMatrixOptions;
  private content: Content = { kind: 'text', text: '' };
  private cols = 1;
  private rows = 1;
  private display: Float32Array = new Float32Array(1);
  /** Disc facing per grid cell: 1 face-on, 0 edge-on (see flipdot). */
  private spin: Float32Array = new Float32Array(1).fill(1);
  private anim: Anim | null = null;
  private marquee: { content: Frame; offset: number; last: number } | null = null;
  private raf = 0;
  private geo: Geometry | null = null;
  private motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

  constructor(private canvas: HTMLCanvasElement, options: Partial<DotMatrixOptions> = {}, text = '') {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('DotMatrix: 2D canvas not supported');
    this.ctx = ctx;
    this.o = { ...defaultOptions, ...options };
    this.motionQuery?.addEventListener('change', this.onMotionChange);
    this.show({ kind: 'text', text }, 'none', true);
  }

  /** Update options. Layout changes apply instantly; the content stays as it is. */
  setOptions(options: Partial<DotMatrixOptions>) {
    this.o = { ...this.o, ...options };
    this.geo = null;
    this.show(this.content, 'none', true);
  }

  /** Show new text, animated with `transition` (defaults to the `transition` option). */
  setText(text: string, transition: TransitionName = this.o.transition, force = false) {
    if (!force && this.content.kind === 'text' && this.content.text === text) return;
    this.show({ kind: 'text', text }, transition, true);
  }

  /** Show a picture already turned into dots (see `svgToBitmap`). */
  setBitmap(bitmap: Bitmap, transition: TransitionName = this.o.transition) {
    this.show({ kind: 'bitmap', bitmap }, transition, true);
  }

  /** Redraw, e.g. after a theme change alters the inherited colour. */
  redraw() {
    this.draw();
  }

  get size() {
    return { cols: this.cols, rows: this.rows, ...this.pixelSize(this.cols, this.rows) };
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.motionQuery?.removeEventListener('change', this.onMotionChange);
  }

  /* ---------- content ---------- */

  private show(next: Content, transition: TransitionName, force: boolean) {
    if (!force && next === this.content) return;
    const prev = this.content;
    this.content = next;
    this.marquee = null;

    let name: TransitionName = this.reduced() || this.o.duration <= 0 ? 'none' : transition;
    const grid = this.gridFor(next);
    const target = this.buildTarget(next, grid.cols, grid.rows);

    if (name === 'count') {
      const a = prev.kind === 'text' ? parseNumber(prev.text) : null;
      const b = next.kind === 'text' ? parseNumber(next.text) : null;
      if (a && b && a.prefix === b.prefix && a.suffix === b.suffix) {
        const other = this.gridFor(prev);
        this.setGrid(Math.max(grid.cols, other.cols), Math.max(grid.rows, other.rows));
        this.anim = { kind: 'count', a, b, start: performance.now(), duration: this.o.duration, final: target };
        return this.loop();
      }
      name = 'fade';
    }

    if (name === 'none') {
      this.anim = null;
      this.setGrid(grid.cols, grid.rows);
      this.display = target.data;
      this.spin.fill(1);
      this.startMarquee();
      return this.draw();
    }

    // Animate on a grid big enough for both the old and new content, starting from whatever is on screen.
    const cols = Math.max(this.cols, grid.cols);
    const rows = Math.max(this.rows, grid.rows);
    const from = resize(this.display, this.cols, this.rows, cols, rows);
    const to = resize(target.data, grid.cols, grid.rows, cols, rows);
    this.setGrid(cols, rows);
    this.display = from.slice();
    this.anim = {
      kind: 'dots',
      fn: transitions[name],
      from,
      to,
      cells: target.cells,
      seed: (Math.random() * 1e6) | 0,
      start: performance.now(),
      duration: this.o.duration,
      final: target,
    };
    this.loop();
  }

  private onMotionChange = () => this.show(this.content, 'none', true);

  private reduced() {
    if (this.o.reducedMotion === 'reduce') return true;
    if (this.o.reducedMotion === 'no-preference') return false;
    return !!this.motionQuery?.matches;
  }

  private round() {
    return this.o.layout !== 'grid';
  }

  private gridFor(c: Content) {
    const natural =
      c.kind === 'text'
        ? measure(c.text, this.o)
        : { cols: c.bitmap.cols + this.o.padding * 2, rows: c.bitmap.rows + this.o.padding * 2 };
    if (this.round()) {
      // A round face needs a square grid; leave a margin so corners of the content aren't cut.
      const side = this.o.cols ?? Math.max(natural.cols, natural.rows) + (c.kind === 'text' ? 4 : 0);
      return { cols: side, rows: side };
    }
    return { cols: this.o.cols ?? natural.cols, rows: this.o.rows ?? natural.rows };
  }

  /** The frame to land on. For a scrolling marquee, that's the first window of the strip. */
  private buildTarget(c: Content, cols: number, rows: number): Frame {
    const lo = this.round() ? { ...this.o, align: 'center' as const, vAlign: 'middle' as const } : this.o;
    if (c.kind === 'bitmap') return placeBitmap(c.bitmap, cols, rows);
    const needed = measure(c.text, lo).cols;
    if (!this.o.marquee || this.o.cols == null || needed <= cols) return layout(c.text, lo, cols, rows);
    const strip = layout(c.text, { ...lo, align: 'left' }, needed + this.o.marqueeGap, rows);
    const data = resize(strip.data, strip.cols, rows, cols, rows);
    return { cols, rows, data, cells: strip.cells.filter((cell) => cell.x < cols) };
  }

  private startMarquee() {
    if (this.content.kind !== 'text') return;
    const lo = this.round() ? { ...this.o, vAlign: 'middle' as const } : this.o;
    const needed = measure(this.content.text, lo).cols;
    if (!this.o.marquee || this.o.cols == null || needed <= this.cols || this.reduced()) return;
    const strip = layout(this.content.text, { ...lo, align: 'left' }, needed + this.o.marqueeGap, this.rows);
    this.marquee = { content: strip, offset: 0, last: performance.now() };
    this.loop();
  }

  /* ---------- animation ---------- */

  private loop() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    const a = this.anim;
    if (a) {
      const t = Math.min(1, (now - a.start) / a.duration);
      if (t >= 1) {
        this.anim = null;
        this.setGrid(a.final.cols, a.final.rows);
        this.display = a.final.data;
        this.spin.fill(1);
        this.startMarquee();
      } else if (a.kind === 'count') {
        const v = a.a.value + (a.b.value - a.a.value) * easeInOut(t);
        const lo = this.round() ? { ...this.o, align: 'center' as const } : this.o;
        this.display = layout(formatNumber(v, a.b), lo, this.cols, this.rows).data;
      } else {
        a.fn({ cols: this.cols, rows: this.rows, from: a.from, to: a.to, toCells: a.cells, t, time: now - a.start, seed: a.seed, out: this.display, spin: this.spin });
      }
    } else if (this.marquee) {
      const m = this.marquee;
      m.offset = (m.offset + ((now - m.last) / 1000) * this.o.marqueeSpeed) % m.content.cols;
      m.last = now;
      const shift = Math.floor(m.offset);
      const { cols, rows } = this;
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++)
          this.display[y * cols + x] = m.content.data[y * m.content.cols + ((x + shift) % m.content.cols)];
    }
    this.draw();
    if (this.anim || this.marquee) this.raf = requestAnimationFrame(this.tick);
  };

  /* ---------- geometry ---------- */

  private pixelSize(cols: number, rows: number) {
    const step = this.o.dotSize + this.o.gap;
    return { width: cols * step - this.o.gap, height: rows * step - this.o.gap };
  }

  private setGrid(cols: number, rows: number) {
    if (cols !== this.cols || rows !== this.rows) {
      this.cols = cols;
      this.rows = rows;
      this.geo = null;
    }
    if (this.display.length !== cols * rows) this.display = new Float32Array(cols * rows);
    if (this.spin.length !== cols * rows) this.spin = new Float32Array(cols * rows).fill(1);
    const { width, height } = this.pixelSize(cols, rows);
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.canvas.style.width = `${width}px`;
    this.canvas.style.aspectRatio = `${width} / ${height}`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private geometry(): Geometry {
    if (this.geo) return this.geo;
    const { cols, rows } = this;
    const { dotSize: s, gap, layout: kind } = this.o;
    const step = s + gap;
    const { width, height } = this.pixelSize(cols, rows);
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2;
    const xs: number[] = [];
    const ys: number[] = [];
    const cells: number[] = [];
    for (let gy = 0; gy < rows; gy++)
      for (let gx = 0; gx < cols; gx++) {
        const px = gx * step + s / 2;
        const py = gy * step + s / 2;
        // The circle layout keeps only dots that sit wholly inside the round face.
        if (kind === 'circle' && Math.hypot(px - cx, py - cy) + s / 2 > radius + 0.5) continue;
        xs.push(px);
        ys.push(py);
        cells.push(gy * cols + gx);
      }

    const all = new Path2D();
    for (let i = 0; i < xs.length; i++) this.addDot(all, xs[i], ys[i]);
    this.geo = { x: Float32Array.from(xs), y: Float32Array.from(ys), cell: Int32Array.from(cells), width, height, all };
    return this.geo;
  }

  /** Add one dot centred on (cx, cy). `sx` squashes it horizontally (a disc turning); `grow` pads it in px. */
  private addDot(p: Path2D, cx: number, cy: number, sx = 1, grow = 0) {
    const { dotSize: s, shape } = this.o;
    const h = s / 2 + grow;
    const w = h * sx;
    if (shape === 'circle') {
      p.moveTo(cx + w, cy);
      p.ellipse(cx, cy, w, h, 0, 0, Math.PI * 2);
    } else if (shape === 'rounded' && 'roundRect' in p) {
      p.roundRect(cx - w, cy - h, w * 2, h * 2, Math.min(w, h) * 0.56);
    } else {
      p.rect(cx - w, cy - h, w * 2, h * 2);
    }
  }

  /* ---------- drawing ---------- */

  private resolveColor(value: string | undefined, fallback: string) {
    if (!value) return fallback;
    const v = /^var\((--[^,)]+)/.exec(value);
    if (!v) return value;
    return getComputedStyle(this.canvas).getPropertyValue(v[1]).trim() || fallback;
  }

  private draw() {
    const { ctx, o } = this;
    const g = this.geometry();
    const inherited = getComputedStyle(this.canvas).color || '#000';
    const on = this.resolveColor(o.color, inherited);
    const off = this.resolveColor(o.offColor, on);
    const n = g.cell.length;
    ctx.clearRect(0, 0, g.width, g.height);

    // Unlit dots: one cached path for every dot.
    ctx.fillStyle = off;
    ctx.globalAlpha = o.offOpacity;
    ctx.fill(g.all);

    // Discs mid-turn are drawn on their own, after the flat dots.
    const turning: number[] = [];
    for (let i = 0; i < n; i++) if (this.spin[g.cell[i]] < 0.995) turning.push(i);
    if (turning.length) {
      // Punch out the flat unlit dot underneath so the hole shows behind the turning disc.
      const holes = new Path2D();
      for (const i of turning) this.addDot(holes, g.x[i], g.y[i], 1, 0.75);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.fill(holes);
      ctx.globalCompositeOperation = 'source-over';
    }

    // Lit dots, grouped by brightness so each level is a single fill.
    const levels: (Path2D | null)[] = new Array(LEVELS + 1).fill(null);
    for (let i = 0; i < n; i++) {
      const c = g.cell[i];
      if (this.spin[c] < 0.995) continue;
      const v = this.display[c];
      if (v <= 0.02) continue;
      const l = Math.max(1, Math.round(Math.min(1, v) * LEVELS));
      this.addDot((levels[l] ??= new Path2D()), g.x[i], g.y[i]);
    }
    ctx.fillStyle = on;
    const paint = (alphaScale: number) =>
      levels.forEach((p, l) => {
        if (!p) return;
        ctx.globalAlpha = (l / LEVELS) * alphaScale;
        ctx.fill(p);
      });
    if (o.glow > 0 && 'filter' in ctx) {
      ctx.filter = `blur(${(o.dotSize * 0.9).toFixed(1)}px)`;
      paint(Math.min(1, o.glow));
      ctx.filter = 'none';
    }
    paint(1);

    // Turning discs: squashed to their facing, and darker as they turn away from the light.
    for (const i of turning) {
      const c = g.cell[i];
      const facing = this.spin[c];
      const lit = this.display[c] >= 0.5;
      const shade = 0.35 + 0.65 * facing;
      const p = new Path2D();
      this.addDot(p, g.x[i], g.y[i], Math.max(facing, 0.12));
      ctx.fillStyle = lit ? on : off;
      ctx.globalAlpha = (lit ? 1 : Math.max(o.offOpacity * 1.6, Math.min(1, o.offOpacity + 0.08))) * shade;
      ctx.fill(p);
    }
    ctx.globalAlpha = 1;
  }
}
