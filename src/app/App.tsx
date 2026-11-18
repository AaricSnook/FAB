import { useEffect, useMemo, useRef, useState } from 'react';
import { DotMatrix } from '../dot-matrix';
import { ActivityTable } from './ActivityTable';
import { type Basemap, MapView } from './MapView';
import { Events } from './Events';
import {
  type ClubData,
  type EventsFile,
  type MapFocus,
  type LatLng,
  type Period,
  distanceM,
  findHotspots,
  ICONS,
  PERIODS,
  byAthlete,
  duration,
  groupColor,
  inPeriod,
  initials,
  int,
  km,
  loadClub,
  paceOrSpeed,
  routeSvg,
  sportGroup,
  sportLabel,
  totals,
  when,
} from './lib';

const LED = '#fff1dc';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current!);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function App() {
  const [data, setData] = useState<ClubData | null>(null);
  const [base, setBase] = useState<Basemap | null | undefined>(undefined);
  const [events, setEvents] = useState<EventsFile>({ events: [] });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadClub().then(setData, (e: Error) => setError(e.message));
    // The basemap is optional: without it the map shows routes on a plain ground.
    fetch('./data/basemap.json')
      .then((r) => (r.ok ? r.json() : null))
      .then(setBase, () => setBase(null));
    fetch('./data/events.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then(setEvents, () => {});
  }, []);

  if (error) return <div className="state">{error}</div>;
  if (!data || base === undefined) return <div className="state">Loading club…</div>;
  return <Dashboard data={data} base={base} events={events} />;
}

/** Label a point by the nearest named road, else the nearest place. */
function namer(base: Basemap | null) {
  const pts: [number, number, string][] = [];
  if (base)
    for (const f of base.features.features) {
      const n = f.properties?.n as string | undefined;
      if (!n || f.geometry.type !== 'LineString') continue;
      for (const [lng, lat] of f.geometry.coordinates) pts.push([lat, lng, n]);
    }
  return (p: LatLng) => {
    let best = '';
    let bd = 250;
    for (const [lat, lng, n] of pts) {
      const d = distanceM(p, [lat, lng]);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    let town = '';
    let td = Infinity;
    for (const pl of base?.places ?? []) {
      if (pl.rank === 'hamlet') continue;
      const d = distanceM(p, [pl.lat, pl.lng]);
      if (d < td) {
        td = d;
        town = pl.name;
      }
    }
    if (best && town) return `${best}, ${town}`;
    return best || (town ? `Near ${town}` : `${p[0].toFixed(3)}, ${p[1].toFixed(3)}`);
  };
}

function Dashboard({ data, base, events }: { data: ClubData; base: Basemap | null; events: EventsFile }) {
  const now = Date.now();
  const hasDates = data.activities.some((a) => a.date);
  const [period, setPeriod] = useState<Period>(hasDates ? '30d' : 'all');
  const list = useMemo(() => inPeriod(data.activities, period, now), [data, period, now]);
  const t = totals(list);
  const leaders = byAthlete(list);
  const periodLabel = PERIODS.find((p) => p.id === period)!.label;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const picked = list.find((a) => a.id === selectedId) ?? null;
  const shown = picked ?? list.find((a) => a.route) ?? list[0] ?? null;
  const nameAt = useMemo(() => namer(base), [base]);
  const hotspots = useMemo(() => findHotspots(list, nameAt), [list, nameAt]);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const toMap = (f: MapFocus) => {
    setFocus(f);
    document.querySelector('.map-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const latest = data.activities[0];
  const ticker = [
    data.club.name,
    `${km(t.distance)} KM ${period === 'all' ? 'ALL TIME' : `IN ${periodLabel}`}`,
    `${t.count} ACTIVITIES`,
    latest ? `LATEST: ${latest.athlete} - ${latest.name} ${km(latest.distance)} KM` : '',
  ]
    .filter(Boolean)
    .join('   +   ')
    .toUpperCase();

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <DotMatrix svg={ICONS.Ride} label="" layout="circle" cols={21} dotSize={1.7} gap={0.7} color={LED} offOpacity={0.12} svgOptions={{ threshold: 0.35 }} />
          <div>
            <h1>{data.club.name}</h1>
            <p className="muted">
              {data.club.memberCount} members ·{' '}
              <a href={data.club.url} target="_blank" rel="noreferrer">
                View club on Strava
              </a>
            </p>
          </div>
        </div>
        <div className="status">
          <span className={`badge ${data.source}`}>
            <i />
            {data.source === 'demo' ? 'Demo data' : 'Live'}
          </span>
          <span className="muted">Updated {when(data.generatedAt, now)}</span>
        </div>
      </header>

      <Ticker text={ticker} />

      <section className="stats-head">
        <h2>Club totals</h2>
        {hasDates && (
          <div className="seg" role="radiogroup" aria-label="Time period">
            {PERIODS.map((p) => (
              <button key={p.id} role="radio" aria-checked={period === p.id} className={period === p.id ? 'on' : undefined} onClick={() => setPeriod(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="stats" aria-label={`Totals for ${periodLabel}`}>
        <Stat label="Distance" value={km(t.distance)} unit="km" note={`${t.athletes} of ${data.club.memberCount} athletes active`} />
        <Stat label="Moving time" value={int(t.time / 3600)} unit="hrs" note={t.count ? `${duration(t.time / t.count)} per activity` : '—'} />
        <Stat label="Elevation" value={int(t.elevation)} unit="m" note={`${(t.elevation / 8849).toFixed(1)}× Everest`} />
        <Stat label="Activities" value={int(t.count)} unit="" note={t.count ? `${km(t.distance / t.count)} km average` : '—'} />
      </section>

      <Events
        events={events.events}
        clubName={data.club.name}
        siteUrl={events.siteUrl ?? null}
        onShowOnMap={(e) => e.location?.lat != null && toMap({ center: [e.location.lat, e.location.lng!], zoom: 15 })}
      />

      <div className="main-grid">
        <section className="panel card map-card" aria-labelledby="m-title">
          <header className="card-head">
            <h2 id="m-title">Club map</h2>
            <p className="muted small">Every route this period. Hover to see who, click to trace it.</p>
          </header>
          <MapView activities={list} base={base} hotspots={hotspots} events={events.events} focus={focus} selectedId={picked?.id ?? null} onSelect={setSelectedId} />
        </section>

        <div className="side">
          {shown && <Selected a={shown} latest={!picked} onClear={picked ? () => setSelectedId(null) : undefined} />}
          <section className="panel card" aria-labelledby="h-title">
            <header className="card-head">
              <h2 id="h-title">Hotspots</h2>
              <p className="muted small">Where routes overlap most</p>
            </header>
            <ol className="hot-list">
              {hotspots.map((h, i) => (
                <li key={h.name + i}>
                  <button onClick={() => setFocus({ center: h.center, zoom: 14.5 })}>
                    <span className="hot-rank">{i + 1}</span>
                    <span className="hot-name">{h.name}</span>
                    <span className="hot-meta muted">
                      {h.count} activities · {h.athletes} {h.athletes === 1 ? 'athlete' : 'athletes'}
                    </span>
                  </button>
                </li>
              ))}
              {!hotspots.length && <li className="muted small">Not enough overlapping routes in this period.</li>}
            </ol>
          </section>
        </div>
      </div>

      <div className="lower-grid">
        <ActivityTable activities={list} selectedId={picked?.id ?? null} onSelect={(id) => {
          setSelectedId(id);
          document.querySelector('.map-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }} />
        <section className="panel card" aria-labelledby="l-title">
          <header className="card-head">
            <h2 id="l-title">Leaderboard</h2>
            <p className="muted small">Distance, {period === 'all' ? 'all time' : `last ${periodLabel}`}</p>
          </header>
          <ol className="leaders">
            {leaders.map((r, i) => (
              <li key={r.athlete} title={`${r.athlete}: ${km(r.distance)} km over ${r.count} activities, ${duration(r.time)}`}>
                <span className="rank">{i + 1}</span>
                <span className="avatar" aria-hidden>
                  {initials(r.athlete)}
                </span>
                <span className="lname">{r.athlete}</span>
                <span className="lval">
                  {km(r.distance)} <small>km</small>
                </span>
                <span className="bar" aria-hidden>
                  <span style={{ width: `${(r.distance / leaders[0].distance) * 100}%` }} />
                </span>
              </li>
            ))}
            {!leaders.length && <li className="muted">No activities in this period.</li>}
          </ol>
        </section>
      </div>

      <footer className="foot muted small">
        {data.source === 'demo'
          ? 'Showing generated demo data. Run the Strava sync to switch to the live club feed.'
          : 'Data from the Strava club feed. Dates are when the sync first saw each activity.'}
      </footer>
    </div>
  );
}

function Ticker({ text }: { text: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const dot = w < 560 ? 3 : 4;
  const gap = w < 560 ? 1.4 : 1.8;
  const cols = Math.max(20, Math.floor((w + gap) / (dot + gap)));
  return (
    <div className="ticker" ref={ref}>
      {w > 0 && (
        <DotMatrix
          value={text}
          cols={cols}
          rows={9}
          marquee
          marqueeSpeed={18}
          marqueeGap={16}
          dotSize={dot}
          gap={gap}
          color={LED}
          offOpacity={0.06}
          glow={0.5}
          transition="scramble"
          label={text}
        />
      )}
    </div>
  );
}

function Stat({ label, value, unit, note }: { label: string; value: string; unit: string; note: string }) {
  // Count up from zero on load, then let the unlit dots fade away so the number stands alone.
  const decimals = value.split('.')[1]?.length ?? 0;
  const [shown, setShown] = useState(decimals ? `0.${'0'.repeat(decimals)}` : '0');
  const [off, setOff] = useState(0.1);
  useEffect(() => {
    const t = setTimeout(() => setShown(value), 120);
    return () => clearTimeout(t);
  }, [value]);
  useEffect(() => {
    let raf = 0;
    const t = setTimeout(() => {
      const start = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / 600);
        setOff(Number((0.1 * (1 - k)).toFixed(3)));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, 1450);
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div className="panel stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        <DotMatrix value={shown} rows={7} dotSize={4} gap={1.6} color={LED} offOpacity={off} glow={0.35} transition="count" duration={1100} live label={`${value} ${unit}`} />
        {unit && <span className="unit">{unit}</span>}
      </div>
      <div className="stat-note">{note}</div>
    </div>
  );
}

function Selected({ a, latest, onClear }: { a: ClubData['activities'][number]; latest: boolean; onClear?: () => void }) {
  const g = sportGroup(a.sport);
  const colour = groupColor(g);
  const svg = a.route ? routeSvg(a.route) : ICONS[g];
  return (
    <section className="panel card selected-card" aria-label="Selected activity" style={{ ['--c' as string]: colour }}>
      <div className="sel-art" style={{ ['--c' as string]: colour }}>
        <DotMatrix svg={svg} layout="circle" cols={27} dotSize={3.4} gap={1.4} color={colour} offColor="#ffffff" offOpacity={0.07} glow={0.6} transition="flipdot" duration={900} svgOptions={{ threshold: 0.3 }} label={a.route ? `Route shape of ${a.name}` : sportLabel(a.sport)} />
      </div>
      <div className="sel-body">
        <div className="sel-top">
          <span className="sel-tag">{latest ? 'Latest' : 'Selected'}</span>
          {onClear && (
            <button className="sel-clear" onClick={onClear} aria-label="Clear selection">
              ×
            </button>
          )}
        </div>
        <div className="sel-kicker">
          <i className="swatch" style={{ background: colour }} />
          {sportLabel(a.sport)} · {when(a.date)}
        </div>
        <h3>{a.name}</h3>
        <p className="muted">{a.athlete}</p>
        <dl className="sel-stats">
          <div>
            <dt>Distance</dt>
            <dd>{km(a.distance)} km</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{duration(a.movingTime)}</dd>
          </div>
          <div>
            <dt>{g === 'Run' || g === 'Walk' ? 'Pace' : 'Speed'}</dt>
            <dd>{paceOrSpeed(a)}</dd>
          </div>
          <div>
            <dt>Elevation</dt>
            <dd>{int(a.elevation)} m</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
