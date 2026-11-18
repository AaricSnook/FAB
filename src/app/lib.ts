export type LatLng = [number, number];

export interface Activity {
  id: string;
  athlete: string;
  name: string;
  sport: string;
  /** ISO start time, or null when the source doesn't know it. */
  date: string | null;
  /** Metres. */
  distance: number;
  /** Seconds. */
  movingTime: number;
  elapsedTime: number;
  /** Metres climbed. */
  elevation: number;
  route: LatLng[] | null;
}

export interface ClubData {
  source: 'demo' | 'strava';
  generatedAt: string;
  club: {
    id: string;
    name: string;
    memberCount: number;
    sportType: string;
    url: string;
    home: LatLng | null;
  };
  activities: Activity[];
}

export async function loadClub(): Promise<ClubData> {
  const res = await fetch('./data/club.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Couldn't load club data (${res.status}).`);
  return res.json();
}

/* ---------- sports ---------- */

export type SportGroup = 'Ride' | 'Run' | 'Walk' | 'Other';

/** Fixed categorical order (validated dark-mode steps): ride, run, walk/hike; everything else folds to Other. */
export const SPORT_GROUPS: { id: SportGroup; label: string; color: string }[] = [
  { id: 'Ride', label: 'Ride', color: '#3987e5' },
  { id: 'Run', label: 'Run', color: '#d95926' },
  { id: 'Walk', label: 'Walk & hike', color: '#199e70' },
  { id: 'Other', label: 'Other', color: '#8b8a84' },
];

export function sportGroup(sport: string): SportGroup {
  if (/ride|cycl|velomobile/i.test(sport)) return 'Ride';
  if (/run|wheelchair/i.test(sport)) return 'Run';
  if (/walk|hike/i.test(sport)) return 'Walk';
  return 'Other';
}

export const groupColor = (g: SportGroup) => SPORT_GROUPS.find((s) => s.id === g)!.color;

/** Split CamelCase sport types: "TrailRun" → "Trail run". */
export const sportLabel = (sport: string) =>
  sport.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^(\w)(.*)$/, (_, a: string, b: string) => a + b.toLowerCase());

/* ---------- periods & totals ---------- */

export type Period = '7d' | '30d' | 'all';
export const PERIODS: { id: Period; label: string; days: number | null }[] = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: 'all', label: 'All', days: null },
];

export function inPeriod(list: Activity[], period: Period, now: number) {
  const days = PERIODS.find((p) => p.id === period)!.days;
  if (days == null) return list;
  const from = now - days * 86_400_000;
  return list.filter((a) => a.date && Date.parse(a.date) >= from);
}

export function totals(list: Activity[]) {
  let distance = 0;
  let time = 0;
  let elevation = 0;
  const athletes = new Set<string>();
  for (const a of list) {
    distance += a.distance;
    time += a.movingTime;
    elevation += a.elevation;
    athletes.add(a.athlete);
  }
  return { distance, time, elevation, count: list.length, athletes: athletes.size };
}

export function byAthlete(list: Activity[]) {
  const map = new Map<string, { athlete: string; distance: number; time: number; count: number }>();
  for (const a of list) {
    const row = map.get(a.athlete) ?? { athlete: a.athlete, distance: 0, time: 0, count: 0 };
    row.distance += a.distance;
    row.time += a.movingTime;
    row.count += 1;
    map.set(a.athlete, row);
  }
  return [...map.values()].sort((a, b) => b.distance - a.distance);
}

/* ---------- formatting ---------- */

const nf1 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

export const km = (m: number) => nf1.format(m / 1000);
export const int = (n: number) => nf0.format(n);

export function duration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** Pace for foot sports, speed for everything else. */
export function paceOrSpeed(a: Activity) {
  if (!a.distance || !a.movingTime) return '—';
  const g = sportGroup(a.sport);
  if (g === 'Run' || g === 'Walk') {
    const secPerKm = a.movingTime / (a.distance / 1000);
    const m = Math.floor(secPerKm / 60);
    const s = Math.round(secPerKm % 60);
    return `${m}:${String(s).padStart(2, '0')} /km`;
  }
  if (/swim/i.test(a.sport)) {
    const per100 = a.movingTime / (a.distance / 100);
    return `${Math.floor(per100 / 60)}:${String(Math.round(per100 % 60)).padStart(2, '0')} /100m`;
  }
  return `${nf1.format(a.distance / 1000 / (a.movingTime / 3600))} km/h`;
}

const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export function when(iso: string | null, now = Date.now()) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  const mins = Math.round((now - t) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  if (mins < 60 * 12) return `${Math.round(mins / 60)}h ago`;
  const d = new Date(t);
  const today = new Date(now);
  const yest = new Date(now - 86_400_000);
  if (d.toDateString() === today.toDateString()) return `Today ${timeFmt.format(d)}`;
  if (d.toDateString() === yest.toDateString()) return `Yesterday ${timeFmt.format(d)}`;
  return dayFmt.format(d);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/* ---------- geometry ---------- */

/** Equirectangular projection of a set of routes into a `w` × `h` box with `pad` px margin. */
export function projector(routes: LatLng[][], w: number, h: number, pad: number) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const r of routes)
    for (const [lat, lng] of r) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  if (!isFinite(minLat)) return null;
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max(1e-6, (maxLng - minLng) * k);
  const spanY = Math.max(1e-6, maxLat - minLat);
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
  const ox = (w - spanX * scale) / 2;
  const oy = (h - spanY * scale) / 2;
  return ([lat, lng]: LatLng): [number, number] => [ox + (lng - minLng) * k * scale, oy + (maxLat - lat) * scale];
}

/** Route as SVG markup (black stroke on transparent), for svgToBitmap. */
export function routeSvg(route: LatLng[]) {
  const size = 100;
  const p = projector([route], size, size, 6)!;
  const d = route.map((pt, i) => `${i ? 'L' : 'M'}${p(pt).map((n) => n.toFixed(2)).join(' ')}`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><path d="${d}" fill="none" stroke="#000" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/* ---------- icons (simple originals on a 24-unit grid) ---------- */

const stroke = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS: Record<SportGroup, string> = {
  Ride: stroke('<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9.5 8.5l3 8ZM9.5 8.5h6.5l-3.5 8M16 8.5l2.5 8M16 8.5V5.8h2.2"/>'),
  Run: stroke('<circle cx="14.5" cy="4.5" r="2"/><path d="M8 21l3-6 3 2v5M6 12l3-4 4 1 2 4 3 1M11 15l2-6"/>'),
  Walk: stroke('<path d="M2 20 9 8l3.5 5.5L15.5 9 22 20Z"/><path d="M7.2 11 9 12.5l1.6-1.4"/>'),
  Other: stroke('<path d="M2 15c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M2 20c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/><circle cx="15" cy="6" r="2"/>'),
};

/* ---------- hotspots ---------- */

export interface Hotspot {
  center: LatLng;
  /** Activities passing through. */
  count: number;
  athletes: number;
  name: string;
}

const HOT_CELL = 0.0035; // ≈ 390 m of latitude

/**
 * Where the club's routes overlap most: route points binned into ~400 m cells,
 * counted once per activity, then the busiest cells at least ~2 km apart.
 * `nameAt` labels each one (e.g. the nearest named road).
 */
export function findHotspots(list: Activity[], nameAt: (p: LatLng) => string, max = 5): Hotspot[] {
  const cells = new Map<string, { acts: Set<string>; athletes: Set<string>; lat: number; lng: number; n: number }>();
  for (const a of list) {
    if (!a.route) continue;
    const k = Math.cos((a.route[0][0] * Math.PI) / 180);
    const seen = new Set<string>();
    for (const [lat, lng] of a.route) {
      const key = `${Math.floor(lat / HOT_CELL)}:${Math.floor((lng * k) / HOT_CELL)}`;
      let c = cells.get(key);
      if (!c) cells.set(key, (c = { acts: new Set(), athletes: new Set(), lat: 0, lng: 0, n: 0 }));
      c.lat += lat;
      c.lng += lng;
      c.n++;
      if (seen.has(key)) continue;
      seen.add(key);
      c.acts.add(a.id);
      c.athletes.add(a.athlete);
    }
  }
  const ranked = [...cells.values()].filter((c) => c.acts.size >= 3).sort((a, b) => b.acts.size - a.acts.size || b.athletes.size - a.athletes.size);
  const out: Hotspot[] = [];
  for (const c of ranked) {
    const center: LatLng = [c.lat / c.n, c.lng / c.n];
    if (out.some((h) => distanceM(h.center, center) < 2000)) continue;
    out.push({ center, count: c.acts.size, athletes: c.athletes.size, name: nameAt(center) });
    if (out.length >= max) break;
  }
  return out;
}

export function distanceM([a1, o1]: LatLng, [a2, o2]: LatLng) {
  const k = Math.cos((((a1 + a2) / 2) * Math.PI) / 180);
  return Math.hypot(a2 - a1, (o2 - o1) * k) * 111_320;
}

/* ---------- events ---------- */

export interface ClubEvent {
  id: string;
  title: string;
  sport: string;
  /** ISO 8601 with offset. */
  start: string;
  end: string;
  location?: { name: string; lat?: number; lng?: number };
  description?: string;
  /** Metres. */
  distance?: number;
  /** Link to the event on Strava, if it came from there. */
  url?: string;
}

export interface EventsFile {
  siteUrl?: string;
  events: ClubEvent[];
}

/** Where the map should fly to. */
export interface MapFocus {
  center: LatLng;
  zoom: number;
  /** Turn the event pins on when flying here. */
  showEvents?: boolean;
}
