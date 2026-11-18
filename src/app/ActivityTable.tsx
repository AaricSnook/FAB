import { useMemo, useState } from 'react';
import { type Activity, SPORT_GROUPS, type SportGroup, duration, groupColor, initials, int, km, paceOrSpeed, sportGroup, sportLabel, when } from './lib';

type Key = 'date' | 'athlete' | 'name' | 'distance' | 'movingTime' | 'elevation';

const COLUMNS: { key: Key | null; label: string; num?: boolean }[] = [
  { key: 'athlete', label: 'Athlete' },
  { key: 'name', label: 'Activity' },
  { key: 'date', label: 'When' },
  { key: 'distance', label: 'Distance', num: true },
  { key: 'movingTime', label: 'Time', num: true },
  { key: null, label: 'Pace / speed', num: true },
  { key: 'elevation', label: 'Elev.', num: true },
];

const PAGE = 12;

interface Props {
  activities: Activity[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ActivityTable({ activities, selectedId, onSelect }: Props) {
  const [sport, setSport] = useState<SportGroup | 'all'>('all');
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: 'date', dir: -1 });
  const [limit, setLimit] = useState(PAGE);

  const present = useMemo(() => new Set(activities.map((a) => sportGroup(a.sport))), [activities]);
  const rows = useMemo(() => {
    const list = sport === 'all' ? activities : activities.filter((a) => sportGroup(a.sport) === sport);
    return [...list].sort((a, b) => {
      const x = a[sort.key] ?? '';
      const y = b[sort.key] ?? '';
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [activities, sport, sort]);

  const toggle = (key: Key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'athlete' || key === 'name' ? 1 : -1 }));

  return (
    <section className="panel card table-card" aria-labelledby="t-title">
      <header className="card-head">
        <h2 id="t-title">Activities</h2>
        <div className="chips" role="group" aria-label="Filter by sport">
          <button className={`chip${sport === 'all' ? ' on' : ''}`} aria-pressed={sport === 'all'} onClick={() => setSport('all')}>
            All <span className="count">{activities.length}</span>
          </button>
          {SPORT_GROUPS.filter((g) => present.has(g.id)).map((g) => (
            <button
              key={g.id}
              className={`chip${sport === g.id ? ' on' : ''}`}
              aria-pressed={sport === g.id}
              onClick={() => {
                setSport(g.id);
                setLimit(PAGE);
              }}
            >
              <i className="swatch" style={{ background: g.color }} />
              {g.label}
            </button>
          ))}
        </div>
      </header>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.label} className={c.num ? 'num' : undefined} aria-sort={c.key && sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                  {c.key ? (
                    <button className="sort" onClick={() => toggle(c.key!)}>
                      {c.label}
                      <span className="arrow" aria-hidden>
                        {sort.key === c.key ? (sort.dir === 1 ? '↑' : '↓') : ''}
                      </span>
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((a) => {
              const g = sportGroup(a.sport);
              return (
                <tr
                  key={a.id}
                  className={a.id === selectedId ? 'selected' : undefined}
                  tabIndex={0}
                  onClick={() => onSelect(a.id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(a.id))}
                  aria-selected={a.id === selectedId}
                >
                  <td>
                    <span className="who">
                      <span className="avatar" aria-hidden>
                        {initials(a.athlete)}
                      </span>
                      {a.athlete}
                    </span>
                  </td>
                  <td>
                    <span className="act">
                      <span className="act-name">{a.name}</span>
                      <span className="sport">
                        <i className="swatch" style={{ background: groupColor(g) }} />
                        {sportLabel(a.sport)}
                        {!a.route && <span className="muted"> · no map</span>}
                      </span>
                    </span>
                  </td>
                  <td className="nowrap muted">{when(a.date)}</td>
                  <td className="num">
                    {km(a.distance)} <small>km</small>
                  </td>
                  <td className="num">{duration(a.movingTime)}</td>
                  <td className="num muted">{paceOrSpeed(a)}</td>
                  <td className="num">
                    {int(a.elevation)} <small>m</small>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p className="empty">Nothing here for this filter.</p>}
      </div>
      {rows.length > limit && (
        <button className="more" onClick={() => setLimit((l) => l + PAGE * 2)}>
          Show more <span className="muted">({rows.length - limit} left)</span>
        </button>
      )}
    </section>
  );
}
