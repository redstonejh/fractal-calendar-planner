# Fractal Calendar Planner

A zoomable **fractal year**: twelve frosted-glass month buckets, each containing its day buckets,
on one continuous surface. Mouse over any area and **scroll to zoom into it** — the zoom anchors
at the cursor, gliding from the whole year, into a month, down to a single day. Scroll back out
to see everything. One year for now.

Every month **is a bucket**; every day **is a bucket** (`.fc-day[data-date]` with a `.fc-day-body`
drop surface) — ready to hold cards from the other modules.

## Part of a modular ecosystem

This app is built on the **same codebase and design system as the
[ticketing client](https://github.com/redstonejh/ticketing)** — the same Electron + Vite shell,
auth/SSO (shared `~/.status-monitor/users.json` + `session.json` sign-in), glass recipes (bucket
gradient, is-target hover glow, easing curves, z-order/scrim conventions), and local persistence
patterns. The ticketing pipeline UI ships in this repo intact
(`dashboard/app/static/ticket-stacks.js` + `ticket-detail.js`); re-enable its two script tags in
`dashboard/index.html` to combine the systems on one surface.

## The fractal zoom

- `dashboard/app/static/fractal-calendar.js` — the whole module.
- Zooms via the CSS **layout `zoom` property** (not a transform), so text and borders re-rasterise
  tack-sharp at every depth; panning uses the viewport's real scroll offsets.
- The months' backdrop blur is **counter-scaled** (`--fc-blur = 28/z`) so the effective glass blur
  stays constant instead of exploding with the zoom.
- Level-of-detail follows the zoom: `year` (big month names over the day-grid texture) →
  `month` (day numbers) → `day` (weekday labels), swapped via `data-lod` on the viewport.
- Hooks for other modules: `window.fractalCalendar.dayEl("2026-07-02")`, `.monthEl(7)`, `.zoom()`.

## Run

```bash
npm install
npm start
```
