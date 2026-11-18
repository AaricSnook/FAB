import type { Bitmap } from './layout';

export interface SvgToBitmapOptions {
  /** Dots across. */
  cols: number;
  /** Dots down. Defaults to `cols`. */
  rows?: number;
  /**
   * 0–1. Coverage at or above this lights a dot. 0 keeps soft greyscale
   * edges (dots light partially), which suits detailed icons at low resolution.
   */
  threshold?: number;
  /** Swap lit and unlit, e.g. for a knocked-out icon. */
  invert?: boolean;
  /** Blank dots kept around the picture. */
  padding?: number;
  /**
   * What counts as ink. `auto` uses transparency, or darkness when the
   * picture has a solid background.
   */
  source?: 'auto' | 'alpha' | 'darkness';
}

/** Supersampling: each dot averages SS × SS pixels for clean edges. */
const SS = 4;

/** Make sure the markup will decode as an image: namespace and an explicit size. */
function prepare(svg: string) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const el = doc.documentElement;
  if (el.nodeName !== 'svg' || doc.querySelector('parsererror')) throw new Error('That isn’t valid SVG markup.');
  el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const vb = el.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  let w = parseFloat(el.getAttribute('width') ?? '');
  let h = parseFloat(el.getAttribute('height') ?? '');
  if (!(w > 0 && h > 0)) {
    w = vb && vb[2] > 0 ? vb[2] : 100;
    h = vb && vb[3] > 0 ? vb[3] : 100;
  }
  if (!vb) el.setAttribute('viewBox', `0 0 ${w} ${h}`);
  // Draw large so thin strokes survive, then average down.
  const scale = 512 / Math.max(w, h);
  el.setAttribute('width', String(w * scale));
  el.setAttribute('height', String(h * scale));
  return { markup: new XMLSerializer().serializeToString(el), aspect: w / h };
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The SVG couldn’t be drawn. Check it doesn’t link to outside files.'));
    img.src = src;
  });
}

/** Rasterise SVG markup onto a dot grid. Browser only. */
export async function svgToBitmap(svg: string, opts: SvgToBitmapOptions): Promise<Bitmap> {
  const { cols, rows = cols, threshold = 0.5, invert = false, padding = 0, source = 'auto' } = opts;
  const { markup, aspect } = prepare(svg);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const img = await loadImage(url);
    const innerW = Math.max(1, cols - padding * 2);
    const innerH = Math.max(1, rows - padding * 2);
    // Fit inside the inner area, keeping the picture's proportions.
    let dw = innerW;
    let dh = innerW / aspect;
    if (dh > innerH) {
      dh = innerH;
      dw = innerH * aspect;
    }
    const canvas = document.createElement('canvas');
    canvas.width = cols * SS;
    canvas.height = rows * SS;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, ((cols - dw) / 2) * SS, ((rows - dh) / 2) * SS, dw * SS, dh * SS);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    let mode = source;
    if (mode === 'auto') {
      // A picture with no transparency has a background: read darkness instead.
      let transparent = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] < 250) transparent++;
      mode = transparent > px.length / 4 / 20 ? 'alpha' : 'darkness';
    }

    const data = new Float32Array(cols * rows);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        let sum = 0;
        for (let sy = 0; sy < SS; sy++)
          for (let sx = 0; sx < SS; sx++) {
            const i = ((y * SS + sy) * canvas.width + (x * SS + sx)) * 4;
            const a = px[i + 3] / 255;
            if (mode === 'alpha') sum += a;
            else {
              const lum = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
              sum += (1 - lum) * a;
            }
          }
        let v = sum / (SS * SS);
        if (threshold > 0) v = v >= threshold ? 1 : 0;
        data[y * cols + x] = invert ? 1 - v : v;
      }
    return { cols, rows, data };
  } finally {
    URL.revokeObjectURL(url);
  }
}
