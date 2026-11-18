// Writes calendar files from public/data/events.json:
//   public/data/events/<id>.ics   – one event (Apple Calendar, Outlook desktop, anything)
//   public/data/club-events.ics   – every event, for subscribing
// Runs before every build (see package.json).
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../public/data/events.json', import.meta.url), 'utf8'));
const club = JSON.parse(readFileSync(new URL('../public/data/club.json', import.meta.url), 'utf8')).club;
const dir = new URL('../public/data/events/', import.meta.url);

const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
// RFC 5545: lines over 75 octets fold with CRLF + space.
const fold = (line) => {
  const out = [];
  let s = line;
  while (Buffer.byteLength(s) > 75) {
    let n = 75;
    while (Buffer.byteLength(s.slice(0, n)) > 75) n--;
    out.push(s.slice(0, n));
    s = ' ' + s.slice(n);
  }
  out.push(s);
  return out.join('\r\n');
};

function vevent(e) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${e.id}@${club.id}.club`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(e.end)}`,
    `SUMMARY:${esc(`${e.title} · ${club.name}`)}`,
    `DESCRIPTION:${esc(e.description ?? '')}`,
    `LOCATION:${esc(e.location?.name ?? '')}`,
  ];
  if (e.location?.lat != null) lines.push(`GEO:${e.location.lat};${e.location.lng}`);
  if (e.url) lines.push(`URL:${e.url}`);
  lines.push('END:VEVENT');
  return lines;
}

const calendar = (events, name) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${club.name}//Club feed//EN`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`, ...events.flatMap(vevent), 'END:VCALENDAR']
    .map(fold)
    .join('\r\n') + '\r\n';

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
for (const e of data.events) writeFileSync(new URL(`${e.id}.ics`, dir), calendar([e], e.title));
writeFileSync(new URL('../public/data/club-events.ics', import.meta.url), calendar(data.events, `${club.name} events`));
console.log(`Wrote ${data.events.length} event files + club-events.ics`);
