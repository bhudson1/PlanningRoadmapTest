# v0.4.84: restore working startup and load controls

The v0.4.83 website used native .mjs browser imports. Restricted Windows/PowerShell local web servers can send `.mjs` with an unsupported MIME type (or the app can be opened with `file://`); the browser then refuses to execute the entire module graph. This results in *both* startup buttons doing nothing.

This release bundles existing JS modules into a single classic `app.js` script. No `.mjs` files are requested by the browser at runtime. Existing modules remain in the ZIP as unchanged sources; ArcGIS files are unchanged. `index.html` includes an early error reporter if the JS itself fails to run.

If the local HTTP server still fails to serve exported data, click **Select local export files** and choose both `meta.json` and `grid.geojson` together from their folder. The app parses the files in your browser without a server-side upload; your geographic and factor data is not transmitted to us. External MapLibre still requires access to its CDN.

The `app.js` bundle preserves scoring, layers, imports, open data, area analysis, and hover functions; it only changes the delivery mechanism for the JavaScript.
