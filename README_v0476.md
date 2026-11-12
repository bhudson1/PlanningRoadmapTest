# Planning Opportunity Explorer v0.4.76 — Area comparison to spreadsheet defaults

## Change

The Area Analysis score cards now show the signed difference (±) between the *current scenario* area-weighted mean and the *original default scenario* mean for each of Baseline, Gap and Combined. E.g., `3.47  +0.18 vs default`. Positive values mean the score increased relative to the original workbook baseline, and negative values mean it decreased. Differences are measured in score points on the original 1–5 score scale, not percentages.

The benchmark uses the original spreadsheet weights, original Baseline/Gap membership with Daily Needs and Community Spaces in Baseline, and the original 50/50 Combined blend. It is computed from the same exported grid factor scores and clipped to the same user-drawn polygon. The benchmark is held constant as users change weights or transfer factors to Gap. If a score is not available in either scenario, the difference displays `Δ —` rather than an inaccurate zero. A zero delta displays `±0.00`.

Scores and differences update when scenario weights, factor routing, or Combined balance change. Both the original default means and changes are appended to area CSV and GeoJSON exports. Area shape fills still reflect the current numeric Combined score, and the displayed map layers remain independent.

## Deploy

On GitHub Pages, replace `app.js`, `area_analysis.mjs`, `styles.css`, and `index.html`. Keep the rest of the website and existing data. Hard-refresh and check for v0.4.76 in the footer. No ArcGIS analysis rerun is required.

## Note on accuracy

The default and current area averages use the same intersected grid-cell areas; when a factor is moved and changes score coverage, both averages separately exclude missing cells. Polygon comparisons reflect the grid resolution exported to the website, not the original ArcGIS raster resolution.
