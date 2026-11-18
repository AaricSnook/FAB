import { GLYPH_H, GLYPH_W, getGlyph } from './font';

export type Align = 'left' | 'center' | 'right';

export interface LayoutOptions {
  /** Blank dot columns between characters. */
  letterSpacing: number;
  /** Blank dot rows between lines. */
  lineSpacing: number;
  /** Horizontal alignment inside a fixed-width grid. */
  align: Align;
  /** Blank dots around the content. */
  padding: number;
  /** Vertical alignment inside a grid taller than the text. */
  vAlign: 'top' | 'middle';
}

/** Where a character was stamped on the grid (used by the flip transition). */
export interface Cell {
  ch: string;
  x: number;
  y: number;
}

/** A grid of dot intensities from 0 (off) to 1 (fully lit). */
export interface Frame {
  cols: number;
  rows: number;
  data: Float32Array;
  cells: Cell[];
}

const lines = (text: string) => text.split('\n');

function lineWidth(line: string, o: LayoutOptions) {
  const n = Array.from(line).length;
  return n === 0 ? 0 : n * GLYPH_W + (n - 1) * o.letterSpacing;
}

/** The grid size needed to show `text` with no clipping. */
export function measure(text: string, o: LayoutOptions) {
  const ls = lines(text);
  const contentW = Math.max(1, ...ls.map((l) => lineWidth(l, o)));
  const contentH = ls.length * GLYPH_H + (ls.length - 1) * o.lineSpacing;
  return { cols: contentW + o.padding * 2, rows: contentH + o.padding * 2 };
}

export function emptyFrame(cols: number, rows: number): Frame {
  return { cols, rows, data: new Float32Array(cols * rows), cells: [] };
}

/** Lay `text` out onto a grid of `cols` × `rows` dots. Content that falls outside is clipped. */
export function layout(text: string, o: LayoutOptions, cols: number, rows: number): Frame {
  const frame = emptyFrame(cols, rows);
  const ls = lines(text);
  const inner = cols - o.padding * 2;
  const contentH = ls.length * GLYPH_H + (ls.length - 1) * o.lineSpacing;
  const yShift = o.vAlign === 'middle' ? Math.max(0, Math.floor((rows - o.padding * 2 - contentH) / 2)) : 0;
  ls.forEach((line, li) => {
    const w = lineWidth(line, o);
    let x0 = o.padding;
    if (o.align === 'center') x0 += Math.floor((inner - w) / 2);
    else if (o.align === 'right') x0 += inner - w;
    const y0 = o.padding + yShift + li * (GLYPH_H + o.lineSpacing);
    Array.from(line).forEach((ch, ci) => {
      const x = x0 + ci * (GLYPH_W + o.letterSpacing);
      frame.cells.push({ ch, x, y: y0 });
      stamp(frame, getGlyph(ch), x, y0);
    });
  });
  return frame;
}

/** Draw a glyph into a frame at (x, y), clipping at the edges. */
export function stamp(frame: Frame, glyph: Uint8Array, x: number, y: number, into = frame.data) {
  for (let gy = 0; gy < GLYPH_H; gy++) {
    const fy = y + gy;
    if (fy < 0 || fy >= frame.rows) continue;
    for (let gx = 0; gx < GLYPH_W; gx++) {
      const fx = x + gx;
      if (fx < 0 || fx >= frame.cols) continue;
      into[fy * frame.cols + fx] = glyph[gy * GLYPH_W + gx];
    }
  }
}

/** Copy a frame's dots onto a grid of a different size, anchored top-left. */
export function resize(data: Float32Array, cols: number, rows: number, toCols: number, toRows: number) {
  const out = new Float32Array(toCols * toRows);
  for (let y = 0; y < Math.min(rows, toRows); y++) {
    for (let x = 0; x < Math.min(cols, toCols); x++) out[y * toCols + x] = data[y * cols + x];
  }
  return out;
}

/** A picture already turned into dots (see svgToBitmap). */
export interface Bitmap {
  cols: number;
  rows: number;
  /** Intensities 0–1, row by row. */
  data: Float32Array;
}

/** Centre a bitmap on a grid, clipping anything that doesn't fit. */
export function placeBitmap(b: Bitmap, cols: number, rows: number): Frame {
  const frame = emptyFrame(cols, rows);
  const x0 = Math.floor((cols - b.cols) / 2);
  const y0 = Math.floor((rows - b.rows) / 2);
  for (let y = 0; y < b.rows; y++) {
    const fy = y + y0;
    if (fy < 0 || fy >= rows) continue;
    for (let x = 0; x < b.cols; x++) {
      const fx = x + x0;
      if (fx < 0 || fx >= cols) continue;
      frame.data[fy * cols + fx] = b.data[y * b.cols + x];
    }
  }
  return frame;
}
