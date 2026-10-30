# Planning Opportunity Explorer — GitHub Pages app

An interactive MapLibre map with a **key-free light-gray OpenStreetMap basemap**, three large **Gap / Baseline / Combined** tabs, and spreadsheet-default integer weight steppers for fixed 100 m planning opportunity polygons. Runs entirely in the browser.

## First run

1. Run **5. Export Dynamic 100m Scenario Grid and Web Data** in the companion ArcGIS Pro `PlanningOpportunityToolbox.pyt`, pointing its output web-app folder to this folder.
2. Confirm `data/grid.geojson` and `data/meta.json` have been generated. To add context layers, use the optional **Reference layers** value-table in Tool 5: select polygon/line/point layers, their label field, legend name, and colour. If they are missing, the website offers synthetic example data for UI testing only.
3. Test locally using `py -m http.server 8000` from this directory, then visit `http://localhost:8000`.
4. Publish these files at the **repository root** of a GitHub Pages repo. In GitHub **Settings → Pages**, choose **Deploy from a branch**, then `main / (root)`.
5. After another ArcGIS export, commit `data/grid.geojson`, `data/meta.json`, and the generated `data/references/*.geojson` files. Refresh the website to view the new model.

There are two draggable routing switches, **Daily Needs → Gap** and **Community Centres / Spaces → Gap**. Reassigned factors reverse their 1–5 accessibility score, and stage totals are flagged until rebalanced to 100%; scores still use weighted averages of available factors. Scenarios can be shared in URL hashes and exported as score CSVs.

**Reference-only update:** In Tool 5, enable **Update only web reference layers** to refresh the overlay files and metadata without rerunning the 10 m raster aggregation or rewriting `grid.geojson`. The web app has separate layer visibility and label controls; label rendering is local canvas text, not a glyph API. The exporter strips other attributes from reference data before publication.

**Basemap:** Uses `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, displayed in greyscale, with visible © OpenStreetMap contributors attribution. The map dropdown also has **Plain grey** (no external tiles). Follow the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/) on public deployments; this community service is not guaranteed for high-traffic websites.

**Caveats:** The site does not fetch live ArcGIS layers or persist user changes to the underlying GIS outputs. The mapping classification is fixed rather than Jenks. The MapLibre JS and OpenStreetMap raster tiles require an internet connection. Ensure the public GeoJSON is cleared for publication.

See `../README_DYNAMIC_GRID_v0458.md` in the full toolbox for the methodology and all export field semantics.

## Interface (v0.4.63)

- **Gap** tab: the four housing diversity factors (existing tenure, existing type, pipeline tenure, pipeline type), each with its own integer percent stepper and live 100% total warning. Optional factors moved from Baseline also appear here.
- **Baseline** tab: an independent integer percent stepper for every Baseline factor, in the original spreadsheet order and with its original percent weight; preserved optional Daily Needs / Community Spaces routing toggles.
- **Default comparison:** Every weight shows its workbook default and a signed +/− adjustment. Baseline and Gap have independent 100% audits; recalculation remains live, without secretly altering user inputs.
- **Combined Gap + Baseline** tab: **only one adjustment** for the Baseline-versus-Gap blend. The two sets of factor weights are not modified.
- All tabs change the map display to the selected score; score changes propagate immediately. The basemap uses OpenStreetMap standard tiles with MapLibre desaturation. No CARTO key is required; Plain grey works without tile requests.
- Demo data are synthetic and clearly identified. Previous bivariate calculation code is retained internally, but the primary user interface prioritizes the requested three single-score tabs.

For existing v0.4.58 exports, no ArcGIS rerun is needed: copy the new web-app files over the old site, retaining `data/grid.geojson` and `data/meta.json`.

## Weight defaults (v0.4.63)

The ArcGIS exporter has always emitted workbook factors in spreadsheet row order and stored `original_weight_pct` in each metadata factor. This update uses those source values rather than 5-point equal defaults. The controls use whole percentage points, show ± changes relative to that default, and flag stage totals other than 100%. For legacy exported metadata without weights, zero is shown rather than inventing workbook values; rerun Tool 5 against the companion workbook for accurate defaults. The map applies the weighted mean even during an unbalanced edit so interactive exploration remains responsive. The sample demo carries synthetic scores and workbook-aligned defaults but is not an actual planning analysis.
