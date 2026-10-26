# Planning Opportunity Explorer — GitHub Pages app

An interactive MapLibre map and normalized factor-weight sliders for fixed 100 m planning opportunity polygons. Runs entirely in the browser.

## First run

1. Run **4. Export Dynamic 100m Scenario Grid and Web Data** in the companion ArcGIS Pro `PlanningOpportunityToolbox.pyt`, pointing its output web-app folder to this folder.
2. Confirm `data/grid.geojson` and `data/meta.json` have been generated. If they are missing, the website offers synthetic example data for UI testing only.
3. Test locally using `py -m http.server 8000` from this directory, then visit `http://localhost:8000`.
4. Publish these files at the **repository root** of a GitHub Pages repo. In GitHub **Settings → Pages**, choose **Deploy from a branch**, then `main / (root)`.
5. After another ArcGIS export, commit `data/grid.geojson` and `data/meta.json`. Refresh the website to view the new model.

There are two draggable routing switches, **Daily Needs → Gap** and **Community Centres / Spaces → Gap**. Reassigned factors reverse their 1–5 accessibility score, and weights renormalize to 100% within their new stage. Scenarios can be shared in URL hashes and exported as score CSVs.

**Caveats:** The site does not fetch live ArcGIS layers or persist user changes to the underlying GIS outputs. The mapping classification is fixed rather than Jenks. The MapLibre JS and OpenStreetMap raster tiles require an internet connection. Ensure the public GeoJSON is cleared for publication.

See `../README_DYNAMIC_GRID_v0454.md` in the full toolbox for the methodology and all export field semantics.
