# v0.4.71 — Exact darkest-green highest-score cells

This patch tightens the relative symbology in the v0.4.70 website. It does not change numerical scores or the ArcGIS Pro analysis.

- Each of Baseline, Gap, and Combined uses the actual minimum and maximum of valid **current-scenario** cell scores. The lowest cell receives `#a60126` dark red; the highest receives `#006837` dark green. Nine stops interpolate continuously between those extremes.
- Endpoint checks ensure the colours are exact, even if tiny numerical differences arise between JavaScript scoring and the map's paint expressions.
- Analysis polygons are fully opaque. Previously they were rendered at 92% opacity, which washed the dark-green colour out by mixing with the underlying grey basemap. Native vector street labels remain above the thematic polygons.
- Legends explicitly mark **Highest = darkest green**. If every cell has the same score, all valid cells appear dark green and the legend explains why. Missing-score cells remain grey.
- The footer shows `v0.4.71`, and the stylesheet / app script have versioned URLs to bypass stale web-browser caches after publication.
- Original 1–5 scores, weight totals and factor-score badges, flexible factor routing, web data, vector basemap, reference layers, open data widget and GIS exporter are preserved.

## GitHub Pages update

Replace `app.js`, `index.html`, and `styles.css` in your deployed site. Leave `model.mjs`, `opendata.mjs`, `data/grid.geojson`, `data/meta.json`, and references unchanged. After GitHub Pages finishes deploying, check the sidebar footer for `v0.4.71`; hard-refresh if you still see the old version.

**This fixes the browser map symbology only**, not ArcGIS Pro layer-file symbology. No analysis or Tool 5 re-export is required.

## Known testing limits

Syntax checks and numerical endpoint regression checks passed against bundled synthetic demo data. No live verification was possible against the user's actual hosted map or datasets.
