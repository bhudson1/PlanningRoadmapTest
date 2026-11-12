# v0.4.79 — Combined score ramp and optional bivariate map

## Changes

- Baseline, Gap and Combined **numeric score maps** use the observed-range-stretched red → yellow → dark-green ramp. The highest score remains the darkest green.
- The **Layers** widget has an unchecked-by-default **4 × 4 bivariate colours for Combined** option immediately under the Combined map choice. When checked, only the Combined map's cells and legend change to the original 16-colour yellow/cyan palette. No scores change.
- Baseline, Gap and Combined score cards in the selected-cell panel, popup, and Area Analysis always use numeric red-to-green colours, regardless of the bivariate map setting. Saved-area polygon fills use the numeric, area-weighted Combined average on the same stretched score gradient.
- Unchanged factor weights no longer display `±0`. Area scores whose change rounds to 0.00 no longer display a difference (or `vs default`). Nonzero score differences are still signed and exports retain their numerical values.
- Existing polygon drawing, area stats, map layer visibility, native labels, Open Data overlays, and scoring logic are unchanged.

## GitHub Pages deployment

Replace `index.html`, `app.js`, and `styles.css` from this bundle; keep your current `data/` folder and the other `.mjs` modules. The site uses a versioned URL (`?v=0479`) to bypass cached code. No ArcGIS Pro rerun is required.

## Validation

Source JavaScript syntax, module consistency, archive integrity, indicator-colour and delta-display tests were performed. Real-world performance and map interactions should be verified on your published website.
