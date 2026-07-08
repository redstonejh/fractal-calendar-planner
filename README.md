# Fractal Calendar Planner

Zoomable Electron calendar built around nested buckets:

- Year view shows 12 month buckets.
- Click a month to animate into its day grid.
- Click a day to animate into the day bucket.
- Press `B` or `Escape` to go back one layer.
- Hovering a month/day highlights it and pre-warms the next view.
- Day buckets are laid out in a fixed 7x6 calendar grid.
- No automatic "today" highlight.

The calendar module lives in `dashboard/app/static/fractal-calendar.js`.

## Run

```bash
npm install
npm start
```
