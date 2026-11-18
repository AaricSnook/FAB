// Downloads OpenStreetMap features around the club's patch from the Overpass API
// and writes:
//   public/data/basemap.json   – compact GeoJSON the map draws (no tile server)
//   scripts/.cache/osm.json    – raw response, reused by make-demo-data.mjs
// Run: node scripts/fetch-basemap.mjs [south west north east]
// Map data © OpenStreetMap contributors, ODbL.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';

const BBOX = process.argv.length === 6 ? process.argv.slice(2).map(Number) : [51.08, 0.1, 51.29, 0.45];
const CACHE = new URL('./.cache/osm.json', import.meta.url);
const OUT = new URL('../public/data/basemap.json', import.meta.url);

const bb = BBOX.join(',');
const query = `[out:json][timeout:180];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|track|path|bridleway|cycleway)$"](${bb});
  way["railway"="rail"](${bb});
  way["waterway"~"^(river|stream|canal)$"](${bb});
  way["natural"="water"](${bb});
  way["landuse"~"^(forest|residential)$"](${bb});
  way["natural"="wood"](${bb});
  node["place"~"^(town|village|suburb|hamlet)$"](${bb});
);
out geom qt;`;

let osm;
if (existsSync(CACHE) && !process.env.REFRESH) {
  osm = JSON.parse(readFileSync(CACHE, 'utf8'));
  console.log('Using cached OSM data (set REFRESH=1 to download again).');
} else {
  console.log('Querying Overpass…');
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'club-dashboard-basemap/0.1' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 300)}`);
  osm = await res.json();
  mkdirSync(new URL('./.cache/', import.meta.url), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(osm));
}
console.log(`${osm.elements.length} OSM elements`);

/* ---------- simplify (Douglas–Peucker in metres) ---------- */
const K = Math.cos((((BBOX[0] + BBOX[2]) / 2) * Math.PI) / 180);
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const t2 = (tol / 111_320) ** 2;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ay, ax] = [pts[a][1], pts[a][0] * K];
    const [by, bx] = [pts[b][1], pts[b][0] * K];
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const py = pts[i][1], px = pts[i][0] * K;
      const dx = bx - ax, dy = by - ay;
      const L = dx * dx + dy * dy;
      let u = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
      u = Math.max(0, Math.min(1, u));
      const d = (ax + u * dx - px) ** 2 + (ay + u * dy - py) ** 2;
      if (d > max) { max = d; idx = i; }
    }
    if (max > t2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const r5 = (n) => Math.round(n * 1e5) / 1e5;
const coords = (geom, tol) => simplify(geom.map((g) => [g.lon, g.lat]), tol).map(([x, y]) => [r5(x), r5(y)]);

function kind(t) {
  const h = t.highway;
  if (h) {
    if (/^(motorway|trunk|primary)$/.test(h)) return 'r0';
    if (/^(secondary|tertiary)$/.test(h)) return 'r1';
    if (/^(unclassified|residential|living_street)$/.test(h)) return 'r2';
    return 'r3';
  }
  if (t.railway === 'rail') return 'rail';
  if (t.waterway === 'river' || t.waterway === 'canal') return 'river';
  if (t.waterway === 'stream') return 'stream';
  if (t.natural === 'water') return 'water';
  if (t.landuse === 'forest' || t.natural === 'wood') return 'wood';
  if (t.landuse === 'residential') return 'urban';
  return null;
}

const TOL = { r0: 6, r1: 6, r2: 5, r3: 6, rail: 10, river: 8, stream: 10, water: 8, wood: 15, urban: 15 };
const features = [];
const places = [];
for (const e of osm.elements) {
  const t = e.tags ?? {};
  if (e.type === 'node' && t.place && t.name) {
    places.push({ name: t.name, rank: t.place, lat: r5(e.lat), lng: r5(e.lon) });
    continue;
  }
  if (e.type !== 'way' || !e.geometry) continue;
  const k = kind(t);
  if (!k) continue;
  const c = coords(e.geometry, TOL[k]);
  const area = k === 'water' || k === 'wood' || k === 'urban';
  if (area) {
    if (c.length < 4) continue;
    const first = c[0], last = c[c.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) c.push(first);
    features.push({ type: 'Feature', properties: { k }, geometry: { type: 'Polygon', coordinates: [c] } });
  } else {
    if (c.length < 2) continue;
    const props = { k };
    if (t.name && /^r[0-2]$/.test(k)) props.n = t.name;
    features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: c } });
  }
}

const rankOrder = { town: 0, suburb: 1, village: 2, hamlet: 3 };
places.sort((a, b) => rankOrder[a.rank] - rankOrder[b.rank]);

const out = { bounds: BBOX, features: { type: 'FeatureCollection', features }, places, attribution: '© OpenStreetMap contributors' };
mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
const counts = features.reduce((m, f) => ((m[f.properties.k] = (m[f.properties.k] ?? 0) + 1), m), {});
console.log('features', counts, 'places', places.length, `size ${(JSON.stringify(out).length / 1e6).toFixed(2)} MB`);
