import { useEffect, useRef, useState } from 'react';
import { DotMatrix } from '../dot-matrix';
import { type ClubEvent, groupColor, km, sportGroup, sportLabel } from './lib';

const TZ = 'Europe/London';
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short' });
const dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric' });
const monFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'short' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const longFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });

/** 20261122T083000Z */
const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function calendarLinks(e: ClubEvent, clubName: string) {
  const title = `${e.title} · ${clubName}`;
  const details = e.description ?? '';
  const where = e.location?.name ?? '';
  const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
  const outlook = (host: string) =>
    `https://${host}/calendar/0/deeplink/compose?${q({ path: '/calendar/action/compose', rru: 'addevent', subject: title, startdt: new Date(e.start).toISOString(), enddt: new Date(e.end).toISOString(), body: details, location: where })}`;
  return {
    google: `https://calendar.google.com/calendar/render?${q({ action: 'TEMPLATE', text: title, dates: `${utc(e.start)}/${utc(e.end)}`, details, location: where })}`,
    apple: `./data/events/${encodeURIComponent(e.id)}.ics`,
    outlook: outlook('outlook.live.com'),
    office: outlook('outlook.office.com'),
  };
}

function shareText(e: ClubEvent, clubName: string, link: string) {
  const when = `${longFmt.format(new Date(e.start))}, ${timeFmt.format(new Date(e.start))}–${timeFmt.format(new Date(e.end))}`;
  return [
    `*${e.title}* · ${clubName}`,
    when,
    e.location?.name ? `Meet: ${e.location.name}` : '',
    e.distance ? `About ${km(e.distance)} km` : '',
    e.description ?? '',
    link ? `Details and add to calendar: ${link}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

interface Props {
  events: ClubEvent[];
  clubName: string;
  /** Public address of this dashboard, used in shared links. */
  siteUrl: string | null;
  onShowOnMap: (e: ClubEvent) => void;
}

export function Events({ events, clubName, siteUrl, onShowOnMap }: Props) {
  const now = Date.now();
  const upcoming = events.filter((e) => Date.parse(e.end) > now).sort((a, b) => a.start.localeCompare(b.start));
  const [hl, setHl] = useState<string | null>(null);
  // .ics files need a normal web host; some previews can't serve them.
  const [icsOk, setIcsOk] = useState(true);
  useEffect(() => {
    fetch('./data/club-events.ics', { method: 'HEAD' })
      .then((r) => setIcsOk(r.ok && /calendar|octet|text/.test(r.headers.get('content-type') ?? 'text')))
      .catch(() => setIcsOk(false));
  }, []);

  // A shared link lands on #event-<id>: scroll to it and highlight it.
  useEffect(() => {
    const go = () => {
      const id = location.hash.startsWith('#event-') ? location.hash.slice(7) : null;
      if (!id) return;
      setHl(id);
      document.getElementById(`event-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    go();
    addEventListener('hashchange', go);
    return () => removeEventListener('hashchange', go);
  }, []);

  return (
    <section className="events" aria-labelledby="e-title">
      <header className="events-head">
        <h2 id="e-title">Upcoming events</h2>
        {upcoming.length > 0 && icsOk && (
          <a className="muted small" href="./data/club-events.ics">
            Download all as .ics
          </a>
        )}
      </header>
      {upcoming.length ? (
        <div className="event-row">
          {upcoming.slice(0, 4).map((e) => (
            <EventCard key={e.id} e={e} clubName={clubName} siteUrl={siteUrl} icsOk={icsOk} highlight={hl === e.id} onShowOnMap={() => onShowOnMap(e)} />
          ))}
        </div>
      ) : (
        <p className="panel card muted">No events coming up. New ones appear here as soon as they're added.</p>
      )}
    </section>
  );
}

function EventCard({ e, clubName, siteUrl, icsOk, highlight, onShowOnMap }: { e: ClubEvent; clubName: string; siteUrl: string | null; icsOk: boolean; highlight: boolean; onShowOnMap: () => void }) {
  const start = new Date(e.start);
  const colour = groupColor(sportGroup(e.sport));
  const cal = calendarLinks(e, clubName);
  const link = siteUrl ? `${siteUrl}#event-${e.id}` : '';
  const text = shareText(e, clubName, link);
  const [copied, setCopied] = useState<'' | 'link' | 'text'>('');
  const menus = useRef<HTMLDivElement>(null);

  // One menu open at a time; clicking elsewhere closes them.
  useEffect(() => {
    const close = (ev: MouseEvent) => {
      menus.current?.querySelectorAll('details[open]').forEach((d) => {
        if (!d.contains(ev.target as Node)) d.removeAttribute('open');
      });
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const copy = async (what: 'link' | 'text') => {
    const value = what === 'link' ? link || text : text;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(''), 1800);
    } catch {
      window.prompt?.('Copy this:', value);
    }
  };

  return (
    <article id={`event-${e.id}`} className={`panel event${highlight ? ' hl' : ''}`} style={{ ['--c' as string]: colour }}>
      <div className="event-date" aria-label={longFmt.format(start)}>
        <span className="ev-dow">{dayFmt.format(start)}</span>
        <DotMatrix value={dateFmt.format(start)} dotSize={3} gap={1.2} color="#fff1dc" offOpacity={0} transition="flipdot" label={longFmt.format(start)} />
        <span className="ev-mon">{monFmt.format(start)}</span>
      </div>
      <div className="event-body">
        <div className="ev-kicker">
          <i className="swatch" style={{ background: colour }} />
          {sportLabel(e.sport)}
          {e.distance ? <span> · {km(e.distance)} km</span> : null}
        </div>
        <h3>{e.title}</h3>
        <p className="ev-time">
          {timeFmt.format(start)}–{timeFmt.format(new Date(e.end))}
        </p>
        {e.location && (
          <button className="ev-where" onClick={onShowOnMap} title="Show on the club map">
            <svg viewBox="0 0 24 24" aria-hidden width="14" height="14">
              <path d="M12 21s-6-5.6-6-11a6 6 0 1 1 12 0c0 5.4-6 11-6 11Z" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="12" cy="10" r="2.2" fill="currentColor" />
            </svg>
            <span>{e.location.name}</span>
          </button>
        )}
      </div>
      <div className="event-actions" ref={menus}>
        <details className="menu">
          <summary className="btn">Add to calendar</summary>
          <div className="menu-pop glass-lite" role="menu">
            <a role="menuitem" href={cal.google} target="_blank" rel="noreferrer">
              Google Calendar
            </a>
            {icsOk ? (
              <a role="menuitem" href={cal.apple} target="_blank" rel="noreferrer">
                Apple Calendar <small>.ics</small>
              </a>
            ) : (
              <span role="menuitem" aria-disabled="true" className="menu-off">
                Apple Calendar
                <small>Available on the live site</small>
              </span>
            )}
            <a role="menuitem" href={cal.outlook} target="_blank" rel="noreferrer">
              Outlook.com
            </a>
            <a role="menuitem" href={cal.office} target="_blank" rel="noreferrer">
              Outlook (work or school)
            </a>
          </div>
        </details>
        <details className="menu">
          <summary className="btn btn-ghost">Share</summary>
          <div className="menu-pop glass-lite" role="menu">
            <a role="menuitem" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
              <span className="wa-dot" aria-hidden />
              WhatsApp
            </a>
            <button role="menuitem" onClick={() => copy('text')}>
              {copied === 'text' ? 'Copied' : 'Copy message'}
            </button>
            {link && (
              <button role="menuitem" onClick={() => copy('link')}>
                {copied === 'link' ? 'Copied' : 'Copy link'}
              </button>
            )}
          </div>
        </details>
      </div>
    </article>
  );
}
