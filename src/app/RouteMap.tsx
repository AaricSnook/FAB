import { useEffect, useMemo, useRef, useState } from 'react';
import { type Activity, type LatLng, groupColor, projector, sportGroup, when, km } from './lib';

const DOT = 3.2;
const GAP = 2.6;
const STEP = DOT + GAP;

const newestFirst = (list: Activity[]) => [...list].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
const latest = (list: Activity[]) => newestFirst(list)[0];

interface Props {
  activities: Activity[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

interface Raster {
  cols: number;
  rows: number;
  /** How many activities pass through each cell. */
  heat: Uint16Array;
  max: number;
  /** Activity indices per cell, for hover. */
  owners: Map<number, number[]>;
  /** Each activity's cells in route order (for the trace animation). */
  paths: Map<string, number[]>;
}

/**
 * Every route in the period rasterised onto a dot grid: brighter dots are
 * travelled more often. The selected activity traces over the top in its sport colour.
 */
export function RouteMap({ activities, selectedId, onSelect }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ x: number; y: number; ids: number[] } | null>(null);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.floor(e.contentRect.width);
      setSize({ w, h: Math.round(Math.min(560, Math.max(300, w * 0.66))) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mapped = useMemo(() => activities.filter((a) => a.route && a.route.length > 1), [activities]);

  const raster = useMemo<Raster | null>(() => {
    if (!size.w || !mapped.length) return null;
    const cols = Math.floor((size.w + GAP) / STEP);
    const rows = Math.floor((size.h + GAP) / STEP);
    const proj = projector(mapped.map((a) => a.route!), cols - 1, rows - 1, 2);
    if (!proj) return null;
    const heat = new Uint16Array(cols * rows);
    const owners = new Map<number, number[]>();
    const paths = new Map<string, number[]>();
    mapped.forEach((a, ai) => {
      const visited = new Set<number>();
      const order: number[] = [];
      const pts = a.route!.map((p) => proj(p as LatLng));
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
        for (let s = 0; s <= n; s++) {
          const x = Math.round(x0 + ((x1 - x0) * s) / n);
          const y = Math.round(y0 + ((y1 - y0) * s) / n);
          const c = y * cols + x;
          if (order[order.length - 1] !== c) order.push(c);
          if (visited.has(c)) continue;
          visited.add(c);
          heat[c]++;
          const o = owners.get(c);
          if (o) o.push(ai);
          else owners.set(c, [ai]);
        }
      }
      paths.set(a.id, order);
    });
    let max = 1;
    for (const v of heat) if (v > max) max = v;
    return { cols, rows, heat, max, owners, paths };
  }, [mapped, size]);

  // Draw: base heat, then the selected route traced in over ~900ms.
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !raster) return;
    const ctx = cv.getContext('2d')!;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = raster.cols * STEP - GAP;
    const h = raster.rows * STEP - GAP;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const selected = mapped.find((a) => a.id === selectedId);
    const path = selected ? raster.paths.get(selected.id) ?? [] : [];
    const colour = selected ? groupColor(sportGroup(selected.sport)) : '';
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const logMax = Math.log1p(raster.max);
    const start = performance.now();
    let raf = 0;

    const dot = (c: number) => {
      const x = (c % raster.cols) * STEP + DOT / 2;
      const y = Math.floor(c / raster.cols) * STEP + DOT / 2;
      ctx.moveTo(x + DOT / 2, y);
      ctx.arc(x, y, DOT / 2, 0, Math.PI * 2);
    };

    const frame = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      // Unlit field.
      ctx.fillStyle = 'rgb(255 255 255 / 0.05)';
      ctx.beginPath();
      for (let c = 0; c < raster.heat.length; c++) if (!raster.heat[c]) dot(c);
      ctx.fill();
      // Heat in levels, warm white.
      const dim = selected ? 0.55 : 1;
      const levels: number[][] = Array.from({ length: 8 }, () => []);
      for (let c = 0; c < raster.heat.length; c++) {
        const v = raster.heat[c];
        if (v) levels[Math.min(7, Math.floor((Math.log1p(v) / logMax) * 7.999))].push(c);
      }
      ctx.fillStyle = '#fff1dc';
      levels.forEach((cells, l) => {
        if (!cells.length) return;
        ctx.globalAlpha = (0.22 + 0.78 * (l / 7)) * dim;
        ctx.beginPath();
        cells.forEach(dot);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      // Selected route trace.
      if (path.length) {
        const t = reduce ? 1 : Math.min(1, (now - start) / 900);
        const n = Math.ceil(path.length * (1 - Math.pow(1 - t, 3)));
        ctx.fillStyle = colour;
        ctx.shadowColor = colour;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        for (let i = 0; i < n; i++) dot(path[i]);
        ctx.fill();
        ctx.shadowBlur = 0;
        // Start marker: a ring around the first dot.
        const c0 = path[0];
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc((c0 % raster.cols) * STEP + DOT / 2, Math.floor(c0 / raster.cols) * STEP + DOT / 2, DOT * 1.6, 0, Math.PI * 2);
        ctx.stroke();
        if (t < 1) raf = requestAnimationFrame(frame);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [raster, selectedId, mapped]);

  const cellAt = (e: { clientX: number; clientY: number }) => {
    if (!raster) return null;
    const r = canvas.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const cx = Math.round((x - DOT / 2) / STEP);
    const cy = Math.round((y - DOT / 2) / STEP);
    // Search a small neighbourhood so thin routes are easy to hit.
    let best: number[] | null = null;
    let bestD = Infinity;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const gx = cx + dx;
        const gy = cy + dy;
        if (gx < 0 || gy < 0 || gx >= raster.cols || gy >= raster.rows) continue;
        const o = raster.owners.get(gy * raster.cols + gx);
        const d = dx * dx + dy * dy;
        if (o && d < bestD) {
          best = o;
          bestD = d;
        }
      }
    return best ? { x, y, ids: best } : null;
  };

  if (!mapped.length) {
    return (
      <div ref={wrap} className="map-empty">
        <p>No routes in this period.</p>
        <p className="muted">Strava's club feed doesn't include maps. Routes appear for members who connect their own account.</p>
      </div>
    );
  }

  const hovered = hover ? newestFirst(hover.ids.map((i) => mapped[i])) : null;

  return (
    <div ref={wrap} className="map" style={{ minHeight: size.h }}>
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Heatmap of ${mapped.length} routes. Use the activities table for details.`}
        onPointerMove={(e) => setHover(cellAt(e))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const h = cellAt(e);
          if (h) onSelect(latest(h.ids.map((i) => mapped[i])).id);
        }}
        style={{ cursor: hover ? 'pointer' : 'default' }}
      />
      {hover && hovered && (
        <div
          className="tip"
          style={{
            left: Math.min(hover.x + 14, size.w - 230),
            top: hover.y + 14 > size.h - 120 ? hover.y - 110 : hover.y + 14,
          }}
        >
          <div className="tip-head">
            {hovered.length} {hovered.length === 1 ? 'activity' : 'activities'} here
          </div>
          {hovered.slice(0, 3).map((a) => (
            <div key={a.id} className="tip-row">
              <i style={{ background: groupColor(sportGroup(a.sport)) }} />
              <span>
                {a.athlete} · {a.name}
              </span>
              <b>{km(a.distance)} km</b>
              <em>{when(a.date)}</em>
            </div>
          ))}
          {hovered.length > 3 && <div className="tip-more">+{hovered.length - 3} more · click to open the latest</div>}
        </div>
      )}
    </div>
  );
}
