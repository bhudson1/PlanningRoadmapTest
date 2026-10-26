# Planning Opportunity Explorer — GitHub Pages app

An interactive MapLibre map with a **simple light-gray CARTO basemap**, three large **Gap / Baseline / Combined** tabs, and normalized factor-weight sliders for fixed 100 m planning opportunity polygons. Runs entirely in the browser.

## First run

1. Run **5. Export Dynamic 100m Scenario Grid and Web Data** in the companion ArcGIS Pro `PlanningOpportunityToolbox.pyt`, pointing its output web-app folder to this folder.
2. Confirm `data/grid.geojson` and `data/meta.json` have been generated. If they are missing, the website offers synthetic example data for UI testing only.
3. Test locally using `py -m http.server 8000` from this directory, then visit `http://localhost:8000`.
4. Publish these files at the **repository root** of a GitHub Pages repo. In GitHub **Settings → Pages**, choose **Deploy from a branch**, then `main / (root)`.
5. After another ArcGIS export, commit `data/grid.geojson` and `data/meta.json`. Refresh the website to view the new model.

There are two draggable routing switches, **Daily Needs → Gap** and **Community Centres / Spaces → Gap**. Reassigned factors reverse their 1–5 accessibility score, and weights renormalize to 100% within their new stage. Scenarios can be shared in URL hashes and exported as score CSVs.

**Caveats:** The site does not fetch live ArcGIS layers or persist user changes to the underlying GIS outputs. The mapping classification is fixed rather than Jenks. The MapLibre JS and OpenStreetMap raster tiles require an internet connection. Ensure the public GeoJSON is cleared for publication.

See `../README_DYNAMIC_GRID_v0458.md` in the full toolbox for the methodology and all export field semantics.

## Interface (v0.4.59)

- **Gap** tab: the four housing diversity factors (existing tenure, existing type, pipeline tenure, pipeline type), each with its own live normalized weight slider. Optional factors moved from Baseline also appear here.
- **Baseline** tab: an independent slider for every Baseline factor, including previously zero-weight factors; preserved optional Daily Needs / Community Spaces routing toggles.
- **Combined Gap + Baseline** tab: **only one adjustment** for the Baseline-versus-Gap blend. The two sets of factor weights are not modified.
- All tabs change the map display to the selected score; score changes propagate immediately. The basemap uses CARTO Positron gray roads and labels, so it requires internet connectivity like MapLibre.
- Demo data are synthetic and clearly identified. Previous bivariate calculation code is retained internally, but the primary user interface prioritizes the requested three single-score tabs.

For existing v0.4.58 exports, no ArcGIS rerun is needed: copy the new web-app files over the old site, retaining `data/grid.geojson` and `data/meta.json`.
