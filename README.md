# Fairly Average Athletes · club feed

A lightweight dashboard for the [Fairly Average Athletes](https://www.strava.com/clubs/2319889) Strava club: headline totals, a sortable activity table, an interactive route map (MapLibre GL) with a heat mode and hotspots, and a leaderboard. It's a static site (Vite + React) that reads one JSON file, `public/data/club.json`.

```bash
npm install
npm run dev          # local dev server
npm run build        # static build in dist/
npm run demo-data    # regenerate the demo dataset
npm run prototype    # single-file build in dist-prototype/ for sharing
```

## Events

Events live in `public/data/events.json` (edit by hand; Strava's public API doesn't expose club events). Each build runs `scripts/build-ics.mjs`, which writes one `.ics` per event plus `club-events.ics` for subscribing. Each event card has:

- **Add to calendar**: Google and Outlook links that open a pre-filled event, and the `.ics` file for Apple Calendar.
- **Share**: a WhatsApp message with the date, meeting point and a link back to `#event-<id>`, or copy the message or link.

Set `siteUrl` in `events.json` to the deployed address so shared links point there.

## Map

`src/app/MapView.tsx` uses MapLibre GL (the open-source fork of Mapbox GL, same API). The basemap is drawn from `public/data/basemap.json`, which `node scripts/fetch-basemap.mjs` builds from OpenStreetMap (roads, paths, water, woods, place names), so no tile server or API key is needed. To use Mapbox instead, swap `baseStyle()` for a Mapbox style URL plus an access token; the route, heat, hotspot and selection layers stay the same.

Hotspots are computed in the browser: route points are binned into ~400 m cells, each counted once per activity, and the busiest cells at least 2 km apart are shown and named after the nearest road or town.

## Data

- **Demo** (default): `npm run demo-data` writes made-up members and routes, so the UI works before any keys exist. The header shows a "Demo data" badge.
- **Live**: `npm run sync` calls the Strava API (`/clubs/:id` and `/clubs/:id/activities`) and writes the same JSON shape. It needs `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` (from a Strava API app at strava.com/settings/api) and `STRAVA_REFRESH_TOKEN` (a club member's token with `read` scope).

The Strava club feed has gaps: there are no activity ids, no start dates and no maps, and names come through as "Firstname L.". The sync script stamps each activity with the time it was first seen and keeps those dates across runs, so it should run on a schedule. Routes for the live feed need members to authorise the app individually (OAuth, `activity:read`), after which their activities' `summary_polyline` can be added to the same JSON. Strava's `/segments/explore` endpoint is another source of hotspots for the area.

## Deploy

`.github/workflows/sync-and-deploy.yml` syncs hourly, commits the JSON and deploys to GitHub Pages. Add the three `STRAVA_*` values as repository secrets, and set Pages to deploy from GitHub Actions. Without secrets, the workflow deploys the demo data.

## Layout

- `src/dot-matrix/`: the dot-matrix engine (canvas) and its React wrapper
- `src/app/`: the dashboard (`App.tsx`, `RouteMap.tsx`, `ActivityTable.tsx`, `lib.ts`)
- `scripts/`: demo-data generator and Strava sync
