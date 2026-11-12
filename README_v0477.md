# v0.4.77 — 4×4 bivariate legend and map layer widget

This is a website-only update. No change to the ArcGIS Pro analysis, source
spreadsheet, or exported `grid.geojson` / `meta.json` data is required.

## Install on GitHub Pages

Replace these five files in the existing web app:

- `index.html`
- `app.js`
- `model.mjs`
- `map_tools.mjs`
- `styles.css`

Keep `area_analysis.mjs`, `opendata.mjs` and the existing `data/` folder as-is.

## Changes

- The Combined map and its legend now use the complete **4 × 4** (16-colour)
  palette, sampled directly from the user's ArcGIS Pro legend. Baseline grows
  low→high from left to right; Gap grows low→high from bottom to top. Each
  axis is divided into four equal intervals of its observed score range.
- Selected-cell popup/score cards and saved-area score cards use yellow for
  the Baseline component, cyan for Gap, and the corresponding bivariate
  colour for Combined. All numeric scores and ± comparisons are unchanged.
- Saved area polygons are also coloured by their *area-weighted Baseline × Gap*
  bivariate class; the numeric Combined average continues to use the
  user-selected balance slider, so the bivariate colour and numeric Combined
  value represent different (complementary) concepts.
- A compact **Layers** widget on the map (collapsed initially) selects
  Baseline, Gap, Combined, or Hide grid and independently toggles **Show drawn
  areas**. This does not erase polygons or alter area statistics/exports.
  The Scenario workspace tabs and Area Analysis map selection remain distinct.
- Factor preview is now triggered only by hovering or keyboard-focusing the
  **View factor on map** control under each factor's name, not by hovering the
  name or weight row.
- Vancouver Open Data stays available, and the obsolete sidebar layer chooser
  in Area Analysis is removed.

## Validation

- JavaScript syntax checks and a 16-class expression-vs-indicator comparison
  passed, including boundary and NoData tests.
- Workbook, ArcGIS toolbox, and exporter were preserved byte-for-byte.
- Live browser interactions were not verified because Chromium local-site
  navigation is blocked in the test environment. Please check the published
  site after deployment, including Layers, factor previews, and drawing.
