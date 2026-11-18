# Fairly Average Athletes · club feed

A lightweight dashboard for the [Fairly Average Athletes](https://www.strava.com/clubs/2319889) Strava club: headline totals, a sortable activity table, a dot-matrix route heatmap and a leaderboard. It's a static site (Vite + React) that reads one JSON file, `public/data/club.json`.

```bash
npm install
npm run dev          # local dev server
npm run build        # static build in dist/
npm run demo-data    # regenerate the demo dataset
```

## Data

- **Demo** (default): `npm run demo-data` writes made-up members and routes, so the UI works before any keys exist. The header shows a "Demo data" badge.
- **Live**: `npm run sync` calls the Strava API (`/clubs/:id` and `/clubs/:id/activities`) and writes the same JSON shape. It needs `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` (from a Strava API app at strava.com/settings/api) and `STRAVA_REFRESH_TOKEN` (a club member's token with `read` scope).

The Strava club feed has gaps: there are no activity ids, no start dates and no maps, and names come through as "Firstname L.". The sync script stamps each activity with the time it was first seen and keeps those dates across runs, so it should run on a schedule. Routes for the live feed need members to authorise the app individually, which is the next step.

## Deploy

`.github/workflows/sync-and-deploy.yml` syncs hourly, commits the JSON and deploys to GitHub Pages. Add the three `STRAVA_*` values as repository secrets, and set Pages to deploy from GitHub Actions. Without secrets, the workflow deploys the demo data.

## Layout

- `src/dot-matrix/`: the dot-matrix engine (canvas) and its React wrapper
- `src/app/`: the dashboard (`App.tsx`, `RouteMap.tsx`, `ActivityTable.tsx`, `lib.ts`)
- `scripts/`: demo-data generator and Strava sync
