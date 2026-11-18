// Writes public/data/club.json with made-up demo activities so the dashboard
// renders before Strava credentials are set up. Deterministic (seeded).
// Run: npm run demo-data
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('../public/data/club.json', import.meta.url);

let seed = 20261118;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + rand() * (b - a);

// Fictional members (demo only).
const ATHLETES = ['Sam K.', 'Alex P.', 'Jordan M.', 'Robin T.', 'Casey D.', 'Morgan W.', 'Jamie R.'];

// Rough area so routes overlap into a believable heatmap (West Kent, UK).
const HOME = [51.195, 0.272];
const HUBS = [
  [51.195, 0.272],
  [51.205, 0.25],
  [51.18, 0.3],
  [51.215, 0.29],
];

const PROFILES = {
  Run: { dist: [4000, 21000], speed: [2.6, 3.7], climb: [6, 14], names: ['Morning Run', 'Lunch Run', 'Evening Run', 'Parkrun', 'Tempo Run', 'Easy miles', 'Long Run'] },
  Ride: { dist: [18000, 95000], speed: [6.2, 8.6], climb: [7, 13], names: ['Morning Ride', 'Coffee Ride', 'Evening Ride', 'Hill reps', 'Weekend Loop', 'Gravel spin'] },
  Walk: { dist: [3000, 11000], speed: [1.2, 1.6], climb: [5, 12], names: ['Afternoon Walk', 'Dog walk', 'Morning Walk'] },
  Hike: { dist: [8000, 18000], speed: [1.0, 1.4], climb: [18, 30], names: ['Weald hike', 'Sunday Hike'] },
  Swim: { dist: [1000, 3000], speed: [0.6, 0.9], climb: [0, 0], names: ['Pool swim', 'Lido swim'] },
};
const SPORT_WEIGHTS = [
  ['Run', 0.42],
  ['Ride', 0.33],
  ['Walk', 0.12],
  ['Hike', 0.05],
  ['Swim', 0.08],
];
const pickSport = () => {
  let r = rand();
  for (const [s, w] of SPORT_WEIGHTS) if ((r -= w) < 0) return s;
  return 'Run';
};

const M_PER_DEG_LAT = 111_320;
const mPerDegLng = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

/** A wobbly closed loop (or out-and-back) of roughly `meters` length. */
function makeRoute(meters) {
  const hub = pick(HUBS);
  const start = [hub[0] + between(-0.006, 0.006), hub[1] + between(-0.008, 0.008)];
  const outAndBack = rand() < 0.3;
  const n = Math.max(40, Math.min(160, Math.round(meters / 250)));
  const pts = [];
  if (outAndBack) {
    const heading = between(0, Math.PI * 2);
    const half = meters / 2;
    const half_n = Math.floor(n / 2);
    let lat = start[0];
    let lng = start[1];
    let h = heading;
    const out = [[lat, lng]];
    for (let i = 1; i <= half_n; i++) {
      h += between(-0.35, 0.35);
      const step = half / half_n;
      lat += (Math.cos(h) * step) / M_PER_DEG_LAT;
      lng += (Math.sin(h) * step) / mPerDegLng(lat);
      out.push([lat, lng]);
    }
    pts.push(...out, ...out.slice(0, -1).reverse());
  } else {
    const r = meters / (2 * Math.PI);
    const phase = between(0, Math.PI * 2);
    const k1 = between(0.1, 0.3);
    const k2 = between(0.05, 0.2);
    const stretch = between(0.6, 1.4);
    const rot = between(0, Math.PI);
    // Centre sits one radius away so the loop passes through the start.
    const cLat = start[0] + (Math.cos(rot) * r) / M_PER_DEG_LAT;
    const cLng = start[1] + (Math.sin(rot) * r) / mPerDegLng(start[0]);
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2 + rot + Math.PI;
      const rr = r * (1 + k1 * Math.sin(3 * t + phase) + k2 * Math.cos(5 * t + phase));
      const x = Math.sin(t) * rr * stretch;
      const y = Math.cos(t) * rr;
      pts.push([cLat + y / M_PER_DEG_LAT, cLng + x / mPerDegLng(cLat)]);
    }
  }
  return pts.map(([a, b]) => [Number(a.toFixed(5)), Number(b.toFixed(5))]);
}

const now = new Date('2026-11-18T08:00:00Z');
const activities = [];
let id = 1;
for (let day = 0; day < 75; day++) {
  const perDay = Math.floor(between(0, 3.2));
  for (let k = 0; k < perDay; k++) {
    const sport = pickSport();
    const p = PROFILES[sport];
    const distance = Math.round(between(...p.dist));
    const speed = between(...p.speed);
    const movingTime = Math.round(distance / speed);
    const date = new Date(now.getTime() - day * 86_400_000 - between(0, 14) * 3_600_000);
    activities.push({
      id: `demo-${id++}`,
      athlete: pick(ATHLETES),
      name: pick(p.names),
      sport,
      date: date.toISOString(),
      distance,
      movingTime,
      elapsedTime: Math.round(movingTime * between(1.02, 1.2)),
      elevation: Math.round((distance / 1000) * between(...p.climb)),
      route: sport === 'Swim' ? null : makeRoute(distance),
    });
  }
}
activities.sort((a, b) => b.date.localeCompare(a.date));

const data = {
  source: 'demo',
  generatedAt: now.toISOString(),
  club: {
    id: '2319889',
    name: 'Fairly Average Athletes',
    memberCount: 7,
    sportType: 'Other',
    url: 'https://www.strava.com/clubs/2319889',
    home: HOME,
  },
  activities,
};

mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
writeFileSync(OUT, JSON.stringify(data));
console.log(`Wrote ${activities.length} demo activities to public/data/club.json`);
