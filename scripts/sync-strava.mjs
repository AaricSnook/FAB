// Pulls the club and its recent activity feed from the Strava API and writes
// public/data/club.json in the shape the dashboard reads.
//
// Env:
//   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET  – from https://www.strava.com/settings/api
//   STRAVA_REFRESH_TOKEN                    – a club member's token with `read` scope
//   STRAVA_CLUB_ID                          – defaults to 2319889
//
// Strava's club feed is deliberately thin: no activity ids, no start dates and
// no maps, and athletes appear as "Firstname L.". To get a timeline anyway we
// keep the previous club.json and stamp each activity with the time we first saw
// it, so running this on a schedule (see .github/workflows) builds up dates.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const OUT = new URL('../public/data/club.json', import.meta.url);
const CLUB_ID = process.env.STRAVA_CLUB_ID || '2319889';
const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN } = process.env;

if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET || !STRAVA_REFRESH_TOKEN) {
  console.error('Missing STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / STRAVA_REFRESH_TOKEN.');
  process.exit(1);
}

async function token() {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: STRAVA_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.refresh_token && json.refresh_token !== STRAVA_REFRESH_TOKEN) {
    console.warn('Strava issued a new refresh token; update the STRAVA_REFRESH_TOKEN secret.');
  }
  return json.access_token;
}

async function api(path, access) {
  const res = await fetch(`https://www.strava.com/api/v3${path}`, { headers: { Authorization: `Bearer ${access}` } });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function readPrevious() {
  if (!existsSync(OUT)) return null;
  try {
    const prev = JSON.parse(readFileSync(OUT, 'utf8'));
    return prev.source === 'strava' ? prev : null;
  } catch {
    return null;
  }
}

const fingerprint = (a) =>
  createHash('sha1')
    .update([a.athlete?.firstname, a.athlete?.lastname, a.name, a.distance, a.moving_time, a.elapsed_time, a.sport_type].join('|'))
    .digest('hex')
    .slice(0, 16);

const access = await token();
const club = await api(`/clubs/${CLUB_ID}`, access);

const raw = [];
for (let page = 1; page <= 5; page++) {
  const batch = await api(`/clubs/${CLUB_ID}/activities?per_page=200&page=${page}`, access);
  raw.push(...batch);
  if (batch.length < 200) break;
}

const prev = readPrevious();
const seen = new Map((prev?.activities ?? []).map((a) => [a.id, a]));
const now = new Date().toISOString();
const firstRun = !prev;

const activities = raw.map((a) => {
  const id = fingerprint(a);
  const old = seen.get(id);
  return {
    id,
    athlete: [a.athlete?.firstname, a.athlete?.lastname].filter(Boolean).join(' '),
    name: a.name,
    sport: a.sport_type || a.type,
    // First sighting stands in for the start date. On the very first sync we
    // can't know, so dates stay empty until later runs see new activities.
    date: old?.date ?? (firstRun ? null : now),
    distance: Math.round(a.distance),
    movingTime: a.moving_time,
    elapsedTime: a.elapsed_time,
    elevation: Math.round(a.total_elevation_gain ?? 0),
    route: old?.route ?? null,
  };
});

const data = {
  source: 'strava',
  generatedAt: now,
  club: {
    id: String(club.id),
    name: club.name,
    memberCount: club.member_count,
    sportType: club.sport_type,
    url: `https://www.strava.com/clubs/${club.id}`,
    home: prev?.club?.home ?? null,
  },
  activities,
};

mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
writeFileSync(OUT, JSON.stringify(data));
console.log(`Synced ${activities.length} activities from "${club.name}".`);
