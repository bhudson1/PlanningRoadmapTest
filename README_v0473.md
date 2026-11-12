# Planning Opportunity Explorer v0.4.73

This is a website-only UI update to v0.4.72. The ArcGIS Pro toolbox, analysis resolution, default workbook weights, and GeoJSON export schema are unchanged.

## Website deployment (GitHub Pages)

Replace `index.html`, `app.js`, `styles.css` and add **`map_tools.mjs`**. Retain existing `model.mjs`, `area_analysis.mjs`, `opendata.mjs`, and actual `data/grid.geojson` and `data/meta.json`.

Do not replace your actual `data` folder with the synthetic demo data in this archive. Hard-refresh your published site after committing and confirm `v0.4.73` in the footer.

## Changes

1. Area drawing: Polygon, Rectangle and Square modes. Rectangle/Square finish on the second click; metric square construction uses local Web Mercator coordinate scaling. In Polygon mode, hold **Shift** or select the **right-angle constraint** to snap the next edge horizontally or vertically on-screen. Double-click or press Enter to finish, Backspace to undo, Esc to cancel.
2. The generated ArcGIS **Map Reference Layers** panel and map overlays are removed; the **Add Vancouver Open Data** catalogue remains.
3. The Baseline and Gap weight totals are sticky at the top while scrolling through their factor rows. Totals still warn if not 100%.
4. Each drawn polygon is filled (78% opacity) using the current **numeric Combined** area-average score colour on the same relative red-to-green ramp used by the Combined score cards. Colour updates when weights or Combined balance changes; no-data is grey.
5. Analysis grid outlines are removed; selected cells and user-drawn area outlines remain.
6. Map-update status now waits for the MapLibre **`idle`** event and two browser frames rather than an early `render` event. If external tiles continue loading, it stays in a busy state with an explanatory message instead of claiming completion.
7. Hover or keyboard-focus a **factor name** to temporarily preview the factor's original numeric field `Vxxx` (where exported) using a **light-to-dark blue** ramp. When no original field is available, the preview uses the exported 1–5 factor score and labels the legend accordingly. Moving away returns to the scenario map. Data remain at the exported grid resolution rather than showing original raster pixels.
8. Combined map displays a **5 × 5 bivariate** Baseline × Gap colour matrix (relative equal-interval classes on each observed axis), derived by interpolation from the former 3 × 3 palette. The numeric Combined score and slider continue to drive area colours, metrics and CSV exports, not the two-axis map colours. This is a web interpretation of the original ArcGIS 5 × 5 scheme, not a byte-for-byte copy of its symbology layer file.

## Validation and limitations

- JavaScript syntax and pure drawing/scoring tests completed.
- Live MapLibre rendering, third-party basemap requests and Open Data API access still need verification on the published website.
- Very large exports (especially a citywide 1 m grid) remain impractical to render or aggregate directly in a browser.
