# v0.4.70 — Full colour ramp and relative score stretch

Changes to the GitHub Pages web interface (no change to the GIS calculations):

- Uses a continuous nine-stop red → orange → pale yellow → light green → dark green ramp sampled from the supplied ArcGIS Pro gradient. Lower scores remain red and higher scores remain green.
- Maps automatically stretch this continuous ramp over the observed minimum and maximum scores *for the active tab*. Scenarios recompute their observed ranges when weights or the Baseline/Gap blend change.
- Legends show the actual, unaltered score minimum, midpoint and maximum (two decimals), and explain that the colour scale is relative to the observed distribution.
- Individual factor badges use the same nine-stop palette, but remain on the FIXED 1–5 factor-score scale. This avoids suggesting that factor values have changed when only the map colour stretch changes.
- Analysis scores, CSV exports, original source values, factor weights, moved categories, reference layers, native basemap labels, the open-data widget and analysis resolution are preserved.
- Grid polygon opacity is 92% instead of 77% so colours remain more saturated, while native vector basemap label layers stay on top.

**Interpretation:** colours are relative *within* each map mode. A red Baseline cell is among the lowest Baseline scores and is not necessarily a numerical score of 1. Comparisons between different tabs or scenarios should use the displayed numeric scores, not colour alone. Null cells remain grey. If a map mode has only one observed value, the fallback fixed 1–5 palette is used.

## Updating GitHub Pages

Replace `app.js`, `model.mjs` and `styles.css`. Keep your own `data/grid.geojson`, `data/meta.json`, and reference data unchanged. Hard-refresh after GitHub Pages publishes.

No re-export or re-analysis in ArcGIS Pro is required. The ArcGIS Pro layer-file templates and native ArcPy symbology are unchanged; these changes affect the web map.

## QA

- JavaScript syntax checks for `app.js` and `model.mjs`.
- Workbook default weight totals remain 100% for Baseline and Gap in the demo export.
- Calculated ranges of sample cells verified for all three map modes.
- Byte-for-byte preservation of all original files apart from the updated website code and release notes.
- Not tested against a live published GitHub Pages website.
