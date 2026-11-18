import { useEffect, useMemo, useRef, useState } from 'react';
import { DotMatrix } from '../dot-matrix';
import { ActivityTable } from './ActivityTable';
import { RouteMap } from './RouteMap';
import {
  type ClubData,
  type Period,
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadClub().then(setData, (e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="state">{error}</div>;
  if (!data) return <div className="state">Loading club…</div>;
  return <Dashboard data={data} />;
}

function Dashboard({ data }: { data: ClubData }) {
  const now = Date.now();
  const hasDates = data.activities.some((a) => a.date);
  const [period, setPeriod] = useState<Period>(hasDates ? '30d' : 'all');
  const list = useMemo(() => inPeriod(data.activities, period, now), [data, period, now]);
  const t = totals(list);
  const leaders = byAthlete(list);
  const periodLabel = PERIODS.find((p) => p.id === period)!.label;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = list.find((a) => a.id === selectedId) ?? list.find((a) => a.route) ?? list[0] ?? null;

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
      <div className="aurora" aria-hidden />
      <header className="top glass">
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

      <div className="main-grid">
        <section className="glass card map-card" aria-labelledby="m-title">
          <header className="card-head">
            <h2 id="m-title">Route heatmap</h2>
            <p className="muted small">Brighter dots are travelled more. Hover a route, click to open it.</p>
          </header>
          <RouteMap activities={list} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
        </section>

        <div className="side">
          {selected && <Selected a={selected} />}
          <section className="glass card" aria-labelledby="l-title">
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
      </div>

      <ActivityTable activities={list} selectedId={selected?.id ?? null} onSelect={setSelectedId} />

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
    <div className="ticker glass" ref={ref}>
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
          offOpacity={0.07}
          glow={0.5}
          transition="scramble"
          label={text}
        />
      )}
    </div>
  );
}

function Stat({ label, value, unit, note }: { label: string; value: string; unit: string; note: string }) {
  return (
    <div className="glass stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        <DotMatrix value={value} cols={41} rows={7} align="left" dotSize={4} gap={1.6} color={LED} offOpacity={0.08} glow={0.35} transition="count" duration={1100} live label={`${value} ${unit}`} />
        {unit && <span className="unit">{unit}</span>}
      </div>
      <div className="stat-note muted">{note}</div>
    </div>
  );
}

function Selected({ a }: { a: ClubData['activities'][number] }) {
  const g = sportGroup(a.sport);
  const colour = groupColor(g);
  const svg = a.route ? routeSvg(a.route) : ICONS[g];
  return (
    <section className="glass card selected-card" aria-label="Selected activity">
      <div className="sel-art" style={{ ['--c' as string]: colour }}>
        <DotMatrix svg={svg} layout="circle" cols={27} dotSize={3.4} gap={1.4} color={colour} offColor="#ffffff" offOpacity={0.07} glow={0.6} transition="flipdot" duration={900} svgOptions={{ threshold: 0.3 }} label={a.route ? `Route shape of ${a.name}` : sportLabel(a.sport)} />
      </div>
      <div className="sel-body">
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
