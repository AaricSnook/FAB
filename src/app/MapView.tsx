import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { type Activity, type ClubEvent, type Hotspot, type LatLng, type MapFocus, groupColor, km, sportGroup, when } from './lib';

/**
 * Basemap: OpenStreetMap features shipped as one GeoJSON file (`k` = kind),
 * so the map needs no tile server. Swap `baseStyle` for a Mapbox/MapTiler
 * style URL in production and keep the overlay layers as they are.
 */
export interface Basemap {
  bounds: [number, number, number, number];
  features: GeoJSON.FeatureCollection;
  places: { name: string; rank: 'town' | 'village' | 'suburb' | 'hamlet'; lat: number; lng: number }[];
}

type Mode = 'lines' | 'heat';

const C = {
  land: '#0b0d12',
  urban: '#11141b',
  wood: '#0c1612',
  water: '#0f1d30',
  waterLine: '#16304f',
  road: ['#3a3f4b', '#2c313b', '#232731', '#1b1f27'],
  rail: '#2a2e38',
  route: '#fff1dc',
};

const lngLat = ([lat, lng]: LatLng): [number, number] => [lng, lat];

function baseStyle(base: Basemap | null): StyleSpecification {
  const roadWidth = (min: number, max: number) => ['interpolate', ['exponential', 1.6], ['zoom'], 9, min, 16, max] as unknown as number;
  return {
    version: 8,
    sources: base ? { base: { type: 'geojson', data: base.features } } : {},
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': C.land } },
      ...((base
        ? [
            { id: 'urban', type: 'fill', source: 'base', filter: ['==', 'k', 'urban'], paint: { 'fill-color': C.urban } },
            { id: 'wood', type: 'fill', source: 'base', filter: ['==', 'k', 'wood'], paint: { 'fill-color': C.wood } },
            { id: 'water', type: 'fill', source: 'base', filter: ['==', 'k', 'water'], paint: { 'fill-color': C.water } },
            { id: 'river', type: 'line', source: 'base', filter: ['==', 'k', 'river'], paint: { 'line-color': C.waterLine, 'line-width': roadWidth(1, 6) } },
            { id: 'stream', type: 'line', source: 'base', filter: ['==', 'k', 'stream'], minzoom: 12, paint: { 'line-color': C.waterLine, 'line-width': 0.8 } },
            { id: 'rail', type: 'line', source: 'base', filter: ['==', 'k', 'rail'], paint: { 'line-color': C.rail, 'line-width': 1.2, 'line-dasharray': [3, 2] } },
            { id: 'r3', type: 'line', source: 'base', filter: ['==', 'k', 'r3'], minzoom: 11.5, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.road[3], 'line-width': roadWidth(0.3, 5) } },
            { id: 'r2', type: 'line', source: 'base', filter: ['==', 'k', 'r2'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.road[2], 'line-width': roadWidth(0.5, 8) } },
            { id: 'r1', type: 'line', source: 'base', filter: ['==', 'k', 'r1'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.road[1], 'line-width': roadWidth(0.8, 12) } },
            { id: 'r0', type: 'line', source: 'base', filter: ['==', 'k', 'r0'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.road[0], 'line-width': roadWidth(1.2, 16) } },
          ]
        : []) as StyleSpecification['layers']),
    ],
  };
}

interface Props {
  activities: Activity[];
  base: Basemap | null;
  hotspots: Hotspot[];
  /** Upcoming events, pinned at their meeting points. */
  events: ClubEvent[];
  /** Fly here when it changes. */
  focus: MapFocus | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function MapView({ activities, base, hotspots, events, focus, selectedId, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>('lines');
  const [showHot, setShowHot] = useState(true);
  const [tip, setTip] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const placeMarkers = useRef<maplibregl.Marker[]>([]);
  const hotMarkers = useRef<maplibregl.Marker[]>([]);

  const mapped = useMemo(() => activities.filter((a) => a.route && a.route.length > 1), [activities]);
  const byId = useMemo(() => new Map(mapped.map((a) => [a.id, a])), [mapped]);

  const routesFC = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: mapped.map((a) => ({
        type: 'Feature',
        properties: { id: a.id, color: groupColor(sportGroup(a.sport)) },
        geometry: { type: 'LineString', coordinates: a.route!.map(lngLat) },
      })),
    }),
    [mapped],
  );

  const heatFC = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: mapped.flatMap((a) =>
        a.route!.filter((_, i) => i % 2 === 0).map((p) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: lngLat(p) } })),
      ),
    }),
    [mapped],
  );

  /* ---------- create ---------- */
  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: baseStyle(base),
      bounds: base ? [[base.bounds[1], base.bounds[0]], [base.bounds[3], base.bounds[2]]] : undefined,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      fadeDuration: 0,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: base?.features.features.length ? '© OpenStreetMap contributors' : undefined }), 'bottom-right');
    m.on('load', () => {
      m.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addSource('heat', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addSource('sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, lineMetrics: true });
      m.addLayer({
        id: 'heat',
        type: 'heatmap',
        source: 'heat',
        layout: { visibility: 'none' },
        paint: {
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 14, 14],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 14, 1.4],
          'heatmap-opacity': 0.9,
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.15, '#3b1d63', 0.35, '#8a2f6e', 0.55, '#d4553a', 0.8, '#f5a742', 1, '#fff1dc'],
        },
      });
      m.addLayer({
        id: 'routes',
        type: 'line',
        source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': C.route,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.16, 14, 0.3],
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 15, 3],
        },
      });
      m.addLayer({ id: 'routes-hit', type: 'line', source: 'routes', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 12 } });
      m.addLayer({
        id: 'sel-glow',
        type: 'line',
        source: 'sel',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 12, 'line-blur': 10, 'line-opacity': 0.55, 'line-gradient': '#fff' as never },
      });
      m.addLayer({
        id: 'sel',
        type: 'line',
        source: 'sel',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 15, 5], 'line-gradient': '#fff' as never },
      });

      m.on('mousemove', 'routes-hit', (e) => {
        const ids = [...new Set((e.features ?? []).map((f) => f.properties!.id as string))];
        m.getCanvas().style.cursor = ids.length ? 'pointer' : '';
        setTip(ids.length ? { x: e.point.x, y: e.point.y, ids } : null);
      });
      m.on('mouseleave', 'routes-hit', () => {
        m.getCanvas().style.cursor = '';
        setTip(null);
      });
      m.on('click', 'routes-hit', (e) => {
        const ids = [...new Set((e.features ?? []).map((f) => f.properties!.id as string))];
        if (ids.length) onSelectRef.current(ids[0]);
      });
      setReady(true);
    });
    map.current = m;
    // Keep the canvas matched to its box, which now stretches with the row.
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
    // The basemap is loaded once before the map mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  /* ---------- place labels (HTML, so no glyph server is needed) ---------- */
  useEffect(() => {
    const m = map.current;
    if (!m || !base) return;
    const update = () => {
      const z = m.getZoom();
      for (const mk of placeMarkers.current) {
        const rank = mk.getElement().dataset.rank!;
        const min = rank === 'town' ? 0 : rank === 'village' ? 10.5 : rank === 'suburb' ? 12 : 13;
        mk.getElement().style.display = z >= min ? '' : 'none';
      }
    };
    placeMarkers.current = base.places.map((p) => {
      const node = document.createElement('div');
      node.className = `place place-${p.rank}`;
      node.dataset.rank = p.rank;
      node.textContent = p.name;
      return new maplibregl.Marker({ element: node }).setLngLat([p.lng, p.lat]).addTo(m);
    });
    update();
    m.on('zoom', update);
    return () => {
      m.off('zoom', update);
      placeMarkers.current.forEach((mk) => mk.remove());
    };
  }, [base]);

  /* ---------- data ---------- */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource('routes') as GeoJSONSource).setData(routesFC);
    (m.getSource('heat') as GeoJSONSource).setData(heatFC);
    if (!selectedId) fitAllRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, routesFC, heatFC]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.setLayoutProperty('heat', 'visibility', mode === 'heat' ? 'visible' : 'none');
    m.setLayoutProperty('routes', 'visibility', mode === 'lines' ? 'visible' : 'none');
  }, [ready, mode]);

  /* ---------- hotspots ---------- */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    hotMarkers.current.forEach((mk) => mk.remove());
    hotMarkers.current = showHot
      ? hotspots.map((h, i) => {
          const node = document.createElement('button');
          node.className = 'hotspot';
          node.style.setProperty('--s', String(0.75 + 0.5 * (h.count / hotspots[0].count)));
          node.innerHTML = `<span>${i + 1}</span>`;
          node.title = `${h.name}: ${h.count} activities, ${h.athletes} athletes`;
          node.setAttribute('aria-label', node.title);
          node.onclick = () => m.flyTo({ center: lngLat(h.center), zoom: Math.max(m.getZoom(), 14), duration: 900 });
          return new maplibregl.Marker({ element: node }).setLngLat(lngLat(h.center)).addTo(m);
        })
      : [];
  }, [ready, hotspots, showHot]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !focus) return;
    m.flyTo({ center: lngLat(focus.center), zoom: focus.zoom, duration: 1100 });
  }, [ready, focus]);

  /* ---------- event pins ---------- */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const now = Date.now();
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' });
    const pins = events
      .filter((e) => e.location?.lat != null && Date.parse(e.end) > now)
      .map((e) => {
        const node = document.createElement('a');
        node.className = 'event-pin';
        node.href = `#event-${e.id}`;
        node.style.setProperty('--c', groupColor(sportGroup(e.sport)));
        node.innerHTML = `<b>${fmt.format(new Date(e.start))}</b><span>${e.title.replace(/[<&>]/g, '')}</span>`;
        node.title = `${e.title}, ${e.location!.name}`;
        return new maplibregl.Marker({ element: node, anchor: 'bottom' }).setLngLat([e.location!.lng!, e.location!.lat!]).addTo(m);
      });
    return () => pins.forEach((p) => p.remove());
  }, [ready, events]);

  /* ---------- selection: fit and trace ---------- */
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const src = m.getSource('sel') as GeoJSONSource;
    if (!selected) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: selected.route!.map(lngLat) } });
    const colour = groupColor(sportGroup(selected.sport));
    const b = new maplibregl.LngLatBounds();
    selected.route!.forEach((p) => b.extend(lngLat(p)));
    m.fitBounds(b, { padding: 70, maxZoom: 14.5, duration: 900 });

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let raf = 0;
    const paint = (p: number) => {
      const grad = p >= 1 ? colour : ['interpolate', ['linear'], ['line-progress'], 0, colour, Math.max(0.0001, p), colour, Math.min(1, p + 0.0002), 'rgba(0,0,0,0)'];
      m.setPaintProperty('sel', 'line-gradient', grad as never);
      m.setPaintProperty('sel-glow', 'line-gradient', grad as never);
    };
    const tick = (now: number) => {
      const t = reduce ? 1 : Math.min(1, (now - start) / 1400);
      paint(1 - Math.pow(1 - t, 3));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, selected]);

  const fitAllRef = useRef(() => {});
  const fitAll = (fitAllRef.current = () => {
    const m = map.current;
    if (!m || !mapped.length) return;
    const b = new maplibregl.LngLatBounds();
    mapped.forEach((a) => a.route!.forEach((p) => b.extend(lngLat(p))));
    m.fitBounds(b, { padding: 40, duration: 900 });
  });

  const tipActs = tip ? tip.ids.map((id) => byId.get(id)!).filter(Boolean) : [];

  return (
    <div className="mapwrap">
      <div ref={el} className="maplibre" role="region" aria-label={`Map of ${mapped.length} routes. The activities table lists the same data.`} />
      <div className="map-tools glass-lite" role="group" aria-label="Map display">
        <div className="seg seg-sm">
          <button className={mode === 'lines' ? 'on' : undefined} aria-pressed={mode === 'lines'} onClick={() => setMode('lines')}>
            Routes
          </button>
          <button className={mode === 'heat' ? 'on' : undefined} aria-pressed={mode === 'heat'} onClick={() => setMode('heat')}>
            Heat
          </button>
        </div>
        <button className={`chip chip-sm${showHot ? ' on' : ''}`} aria-pressed={showHot} onClick={() => setShowHot((v) => !v)}>
          <i className="swatch hot-swatch" /> Hotspots
        </button>
        <button className="chip chip-sm" onClick={fitAll}>
          Fit all
        </button>
      </div>
      {tip && tipActs.length > 0 && (
        <div className="tip" style={{ left: Math.min(tip.x + 14, (el.current?.clientWidth ?? 600) - 250), top: tip.y + 14 > (el.current?.clientHeight ?? 400) - 130 ? tip.y - 120 : tip.y + 14 }}>
          <div className="tip-head">
            {tipActs.length} {tipActs.length === 1 ? 'route' : 'routes'} here
          </div>
          {tipActs.slice(0, 3).map((a) => (
            <div key={a.id} className="tip-row">
              <i style={{ background: groupColor(sportGroup(a.sport)) }} />
              <span>
                {a.athlete} · {a.name}
              </span>
              <b>{km(a.distance)} km</b>
              <em>{when(a.date)}</em>
            </div>
          ))}
          {tipActs.length > 3 && <div className="tip-more">+{tipActs.length - 3} more</div>}
        </div>
      )}
      {!mapped.length && <div className="map-note">No routes in this period.</div>}
    </div>
  );
}
