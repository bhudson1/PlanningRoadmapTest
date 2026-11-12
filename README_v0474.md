# Planning Opportunity Explorer v0.4.74 — ArcGIS-style Combined colours

## Website deployment (GitHub Pages)

Starting from v0.4.73, replace **index.html**, **app.js**, **styles.css**, **map_tools.mjs** and **model.mjs**. Retain your actual `data/grid.geojson`, `data/meta.json`, `opendata.mjs` and `area_analysis.mjs`. Do not overwrite your real data folder with the synthetic demo files in this archive. Hard-refresh after committing and confirm **v0.4.74** in the footer.

## What changed

- Combined map uses the **3×3 yellow–cyan bivariate palette**, sampled from the supplied ArcGIS Pro screenshot. The original screenshot has four classes in each direction; these nine cells are a deliberate reduction to the agreed three classes per axis.
- **Baseline** increases left to right, **Gap** increases bottom to top. The matrix and colour logic were transposed from the screenshot to support that axis orientation. Low/low = pale cream, high Baseline/low Gap = yellow, low Baseline/high Gap = cyan, high/high = blue.
- Both axes use equal-interval thirds of the *observed* score ranges, so the classification responds to weight changes. When all cells on an axis tie, that axis uses the middle class. No-data cells remain grey.
- The map legend shows two component ramps plus the bivariate matrix, with labelled axes and the observed score ranges.
- Existing Baseline and Gap sequential score maps, factor-hover previews, numeric Combined score, slider, score cards, area-analysis polygon colours, CSV export, and GIS analytical methods are **unchanged**. The bivariate colours are a display-only classification, not a new Combined score.

## Verification

- JavaScript syntax checks and 3×3 lookup / colour-logic tests pass.
- Verified embedded web app sources match the standalone ZIP sources.
- ArcGIS Pro/ArcPy workbooks and scripts are not changed. Live published-browser and external-tiles testing remains to be done.
