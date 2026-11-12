# v0.4.81 — Correct factor-preview category colouring

**Issue fixed:** categorical input-source values were encoded as numeric IDs, typically alphabetically, and the input-factor hover preview incorrectly interpolated those IDs as if they were measurements. For Fire Flow, the exported popup lookup maps **1=High, 2=Low, 3=Medium**, so the previous linear blue ramp was misleading.

**New preview behaviour:**
- If `meta.json` includes `native_codes` for the factor and the exported grid has original values (`V###`), the renderer now uses **discrete category matching** against those codes, and the legend shows the actual category names and observed cell counts. In High/Medium/Low categories, the scale is correctly ordered Low (light blue), Medium (mid-blue), High (dark blue), regardless of the codes. For other named categories, swatches distinguish categories without implying a numerical order.
- Continuous numeric original values still use an observed-range blue gradient; factors with no original field still display their 1–5 factor scores.
- Scenario weighting, score map colours, popups, area-analysis calculations, change overlay and reference overlays are untouched.

**Deployment:** Replace `app.js`, `styles.css`, `index.html` from this package. Preserve the existing `data/` folder and other `.mjs` files. Use the same exported `meta.json` / `grid.geojson`; no GIS rerun required if the export includes `native_codes` and original data.

**Test status:** syntax, Fire Flow category-code permutation, categorical MapLibre expression, numeric preview fallback and source/toolbox preservation verified. Published-site rendering still needs verification.
