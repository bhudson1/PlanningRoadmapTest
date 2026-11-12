# v0.4.80 — Change-from-default overlay and delta visibility

## What changed

- In Area Analysis, the signed score difference for **all three** Baseline, Gap, and Combined averages appears whenever **any** factor weight, amenity routing, or Combined balance differs from the original workbook defaults. A score that rounds to zero shows `±0.00 vs default`; the comparison remains hidden when all model settings are at default.
- In selected-cell details, the three score cards also show changes from the fixed default scenario whenever model settings differ from default, including `±0.00`.
- The collapsible **Layers** widget now contains a separate **Show score-change overlay** checkbox and **Compare** selector for Baseline, Gap, or Combined. This overlay draws above the existing score grid and below selected/drawn areas. Red means a decrease, light grey means unchanged, and blue means an increase; no-data cells remain grey.
- The change layer's legend shows signed score-point values stretched *symmetrically around zero* to the largest absolute per-cell change for the selected score type. The full comparison is recomputed from original workbook weights, unmoved factors, and the 50/50 baseline/gap balance; it never compares against a previous intermediate scenario.
- The overlay is opt-in and independent of Baseline / Gap / Combined / Hidden grid choices, the 4×4 optional bivariate Combined layer, and the visibility of saved area polygons. Turning it off immediately restores the score map.
- Layer colouring uses MapLibre paint expressions applied to the existing source. Changes do not re-upload the GeoJSON grid. Normal map render completion still waits for MapLibre's idle event.

## GitHub Pages deployment

Replace `index.html`, `app.js`, `styles.css`, and `model.mjs` in the existing web repository. Keep your current `data/` folder and the other JavaScript files. These four references use the `?v=0480` cache-busting marker where applicable. No new GIS export is needed.

## Testing / limitations

- Validated score calculations against the exported synthetic demo grid for original defaults, edited weights, moved amenity factors, and Combined-balance changes, including MapLibre-style expression evaluation for per-cell differences.
- Checked that only genuine scenario changes reveal area/popup delta labels, even if rounded deltas are `±0.00`, and that returning all controls to defaults hides them.
- Ran JavaScript syntax and package-integrity tests; compared the original ArcGIS toolbox scripts and workbook by SHA-256 to the previous release.
- The website and its MapLibre render lifecycle have **not** been end-to-end browser-tested on the published site. A large real-world dataset may still require performance testing, particularly when the change overlay is enabled.
