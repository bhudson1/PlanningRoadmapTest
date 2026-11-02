# Planning Opportunity Explorer — v0.4.68 (Vancouver Open Data)

This is a static MapLibre website for exported ArcGIS Pro planning opportunity grids.
The prior ArcGIS Portal OAuth sign-in integration has been **removed**.

## Install on GitHub Pages

Replace these files in your existing site:
- `index.html`
- `app.js`
- `styles.css`
- **new** `opendata.mjs`

Delete the superseded `portal.mjs` file from the GitHub repository.
Keep `model.mjs` and your existing `data/grid.geojson`, `data/meta.json`, and
`data/references/` files. The bundled `data/demo_*` files are synthetic.

## Vancouver Open Data layer picker

Open **ADD VANCOUVER OPEN DATA**, search a keyword (e.g. "parks", "streets",
"zoning"), and choose Add. Only datasets with spatial fields (`geo_shape` or
`geo_point_2d`) are listed. The app queries the public Opendatasoft Explore API
v2.1 directly from your browser; **no Esri SDK, OAuth, account, password or API
key** is required.

Map features are requested for the visible extent only and capped at 2,000 per
dataset to avoid freezing the browser. For large layers, zoom in and choose
**Reload extent**. Added layers can be hidden or removed independently of the
scenario scores. Click a feature to inspect up to six public properties. Source
links open the dataset's page on Vancouver's Open Data Portal.

Public API base: https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets
Catalog: https://opendata.vancouver.ca/pages/home/

Limits:
- Only published spatial *record datasets* with queryable geometry; not imagery,
  raster downloads, entire saved maps, CSV-only data or private layers.
- Depending on the dataset's geometry and map extent, a bounding-box query may
  return no records; try zooming out. Very large layers are deliberately partial.
- API availability, CORS permissions and rate limits depend on the public portal.
- The public dataset layer picker requires a live internet connection.
- Overlays are **visual references** and do **not** modify weights or analysis
  scores. Source data from the Excel workbook remains unchanged.

## Existing analysis and export

The scenario tabs open in Baseline → Gap → Combined order. Original factor
scores, weight steppers, moving amenities and native basemap labels remain.
ArcGIS Pro Tool 5 still supports configurable grid cell size, default 100 m.
No rerun of Tool 5 is necessary for this website-only update.

## Verification

JavaScript syntax, standalone and bundled app parity, geometry normalization,
source preservation, and archive checks performed locally. Live browser access
to the Vancouver API was unavailable in the build environment. Verify the
search and one overlay from the published GitHub Pages site.
