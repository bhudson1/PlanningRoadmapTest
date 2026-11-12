# Planning Opportunity Explorer v0.4.75 — Area Analysis map layers

## Area Analysis map layer panel

The Area Analysis workspace has a dedicated **Map layers** panel. Choose exactly one of:
- **Baseline** (default): sequential red–green weighted score;
- **Gap**: sequential red–green weighted gap score;
- **Combined**: yellow–cyan 3×3 bivariate Baseline × Gap colours;
- **Hide grid**: show the basemap, optional Vancouver Open Data overlays, and drawn areas without the coloured analysis grid or selected-cell outline.

Area averages and polygon fills are **unchanged** and continue to reflect the numeric Baseline, Gap and Combined scores under the current weights. No recomputation or re-export is needed to switch visible map layers. The Scenario Model tabs and Area Analysis panel **remember separate map choices** when you switch workspaces.

## Deploy to GitHub Pages

Replace `index.html`, `app.js` and `styles.css` from this ZIP. Keep `model.mjs`, `map_tools.mjs`, `area_analysis.mjs`, `opendata.mjs` and your actual `data/` files. Hard-refresh, then check for **v0.4.75** in the footer.

No ArcGIS Pro analysis rerun needed. This update only changes the web app's map view controls.
