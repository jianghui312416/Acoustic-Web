# GeoVis terrain-worker compatibility

The app's GeoVis bundle exports Cesium 1.73 APIs. The original `Workers/`
terrain decoders were from the 2017 Engine distribution and omitted the mesh
boundary-index arrays consumed by terrain-fill rendering (`Bue`). This caused
`undefined.length` and stopped rendering at grazing camera angles.

This isolated dependency closure is copied unchanged from:
`D:/GEOVIS/ISBP-WEB-0.7.4-20250407-BDP-MY/website/static/geovis/Workers`.
Source copyright/license headers are preserved. Only the three terrain decoder
tasks are routed here by `src/utils/terrainWorkerCompatibility.js`, before any
Earth is created; legacy geometry workers are not replaced.

To refresh from a compatible SDK distribution:
`node scripts/sync-terrain-workers.mjs <Workers-directory>`

Development regression page: `/terrain-regression.html`. It checks real worker
mesh outputs and rendering from nadir through a horizontal camera orientation.
A full browser reload is required after changing workers: running worker
instances are not replaced by hot module updates.
