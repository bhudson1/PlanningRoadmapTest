# Planning Opportunity Explorer v0.4.72 — colour-coded scores + Area Analysis

This update changes the GitHub Pages web application only. The ArcGIS Pro
raster preparation, analysis, exporter and workbook are unchanged.

## Installation

Replace `index.html`, `app.js`, and `styles.css` from this distribution.
**Add `area_analysis.mjs` to the site root** alongside `model.mjs` and
`opendata.mjs`. Keep the existing `data/grid.geojson`, `data/meta.json`, and
`data/references/` files. Refresh the browser, checking v0.4.72 in the footer.

The page loads `polygon-clipping@0.15.7` (MIT license) from the jsDelivr CDN.
Internet access to this library is required for geometry intersections.
No OAuth, sign-in, or other third-party account is required.

## What changed

- Baseline, Gap and Combined top-level score cards and selected-cell score
  cards now use the **same scenario-relative colour stretch** as the active
  map mode (lowest displayed value = deep red; highest = dark green).
  Factor scores continue to show their **absolute** 1–5 colours.
- A separate *Area analysis* side-panel tab lets users draw as many custom
  polygons as they need. Click `Draw polygon`, click corners on the map, then
  **double-click** or select `Finish`. Backspace undoes the last corner;
  Escape cancels the in-progress shape.
- Each saved polygon shows current Baseline, Gap and Combined area-weighted
  means, area overlapping the exported study grid, number of contributing
  cell polygons and the fraction of overlap containing valid scores.
  Rename, zoom to, remove, or clear polygons. Export summary CSV and GeoJSON.
- The polygon summaries update after a completed scenario recalculation.
  Rapid scenario changes invalidate stale, in-progress area calculations.

## Area calculation methodology

The intersection of each drawn polygon and each exported grid polygon is
computed using polygon-clipping, respecting grid cells clipped by the study
boundary and polygon holes. For each score S, the calculation is:

    mean(S) = sum(S_cell * intersection_area_cell) / sum(intersection_area_cell)

Cells with missing / invalid scores are excluded **separately** for Baseline,
Gap, and Combined. The denominator is the overlap with valid-scoring cells,
not the area of the whole drawn polygon. Area sizes are approximate m² using
a local latitude-corrected planar measurement; appropriate for local
comparisons around Vancouver, not a surveyed geodetic area.

These are *summaries of exported cell-average factor scores*. They do not
recompute the underlying original-resolution GIS rasters for a drawn polygon,
and they cannot recover variation lost by aggregating to a coarse web grid.
A 1 m export genuinely prepared from 1 m inputs provides finer zonal detail
than a 100 m export; see the accompanying GIS workflow documentation.

## Testing and limitations

- JavaScript syntax checked with Node 22.
- Synthetic geometry tests for full/partial overlaps, missing data, holes,
  and scenario-weight changes passed.
- Live MapLibre drawing controls and CDN geometry import could not be
  browser-tested in this environment. Test on the published GitHub Pages site.
- Drawn polygons are stored in browser memory for the current session; export
  GeoJSON to keep them. Scenario share links do not include drawn shapes.
- Very large exported grids or many complex polygons may take longer to
  calculate; a progress message appears in Area Analysis.
