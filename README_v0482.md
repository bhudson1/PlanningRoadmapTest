# v0.4.82 — Correct bivariate axis orientation

Corrects only the optional Combined-map 4×4 bivariate display to match the user's ArcGIS Pro screenshot.

- **Vertical (Y)**: Baseline weighted score, low at bottom and high at top (yellow progression).
- **Horizontal (X)**: Gap weighted score, low at left and high at right (cyan/blue progression).
- The palette remains the same 16 colour values; the renderer now maps `row = baseline quartile`, `column = gap quartile`.
- The legend positions and titles use exactly the same row/column indexing as the map.
- Numeric Baseline, Gap and Combined scores, red-to-green score maps and cards, drawn-area fills, scenario weights, change overlay, factor previews, and exported GIS data remain unchanged.

**Update GitHub Pages:** Replace `app.js`, `model.mjs`, and `index.html`. Keep other files and the existing `data/` folder. No GIS rerun is needed. A live published-site visual check is still recommended.
