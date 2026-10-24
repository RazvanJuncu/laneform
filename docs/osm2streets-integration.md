# Glide / osm2streets Integration Lab

## Purpose

This opt-in experimental tool integrates the **real** osm2streets Rust/WebAssembly
street reconstruction engine, pinned to \`osm2streets-js@0.1.4\`, with the existing
Glide MapLibre map. It reconstructs **physical lane polygons and schematic
markings**, not reliable lane-to-lane navigation through junctions.

The aim is to evaluate whether osm2streets can supply a useful geometry layer
for a later dedicated global lane-continuity graph, without replacing
TomTom routing or interfering with the normal navigator.

## How to use

1. Open Glide → **Preferences** → **Street geometry lab**.
2. Move the map to an area or intersection anywhere covered by OSM.
3. Tap **Inspect map center**. This explicitly downloads a very small bounding
   box from \`https://api.openstreetmap.org/api/0.6/map\`. Or load a locally
   saved \`.osm\`/\`.xml\` export via the file input (no OSM API request).
4. Glide loads the pinned osm2streets WASM engine **only when requested**,
   creates lane polygons, lane markings and intersection markings from
   the OSM XML entirely in your browser and overlays the GeoJSON on MapLibre.
5. Inspect the map and exit with **Close**. The engine does not change routing,
   simulation or lane recommendations.

A previously exported osm2streets **GeoJSON FeatureCollection** can also be
imported without loading WASM. It is displayed as lane geometry. This is an
adapter for inspecting actual project outputs and future cached datasets.

## Performance / budget

- The WebAssembly asset is approximately 1.8 MB and is **not loaded during
  normal navigation startup**.
- \`npm run build\` vendors the pinned JS glue and WASM from jsDelivr under
  \`public/vendor/\`. They are deployed on the same origin as Glide. This
  requires build-time internet access but avoids runtime dependencies on
  external JavaScript hosts. The generated assets are not committed.
- One manually initiated **small-area** public OSM map request at a time.
  Radius is 165 m, capped at 190 m, with a 30-second cooldown. No API key.
  No fetching on pan, route planning or during simulation.
- A local OSM XML input is capped at **3 MB**, and imported GeoJSON at 6 MB.
- All generated features stay in the active browser tab, not GitHub or
  a hosted lane database. OSM license and attribution still apply.
- No additional TomTom or Overpass requests are made by this lab.

## Limitations

- osm2streets models road and lane geometry and can render junctions, but
  its project README still lists turning movements / lane-level routing
  among planned functionality. Never treat a reconstructed lane shape as a
  verified legal connection.
- The public OSM editing API may be unavailable or reject CORS in some
  browsers. The **local file import** is an alternative. Do not scale
  live navigation on the public API.
- The WebAssembly interface is pre-1.0 and can change. Pinning version
  0.1.4 makes the prototype reproducible until intentionally upgraded.
- At complicated junctions, OSM lane metadata can be absent or inaccurate.
- This is a stationary geometry research tool, NOT road-ready navigation.

## Next step if the experiment succeeds

Build a route-corridor lane-tile service from regional OSM extracts, with
geojson generated/cached offline by osm2streets. Align the already planned
route to candidate lane roads, then introduce a directed connectivity graph
with restrictions and evidence checks. Use the output to anticipate lanes
that become turn-only or disappear, rather than merely selecting
individual maneuver arrows.

## Sources

- https://github.com/a-b-street/osm2streets
- https://www.npmjs.com/package/osm2streets-js
- https://wiki.openstreetmap.org/wiki/API_v0.6
- https://www.openstreetmap.org/copyright

The osm2streets engine is Apache-2.0; OSM data remains ODbL.
