# Glide — Navigation, refined.

Glide is the visual brand. The GitHub repository and developer identifiers remain named Laneform to preserve deployment URLs and stored preferences. Personal-use navigation research prototype for Bucharest. **v0.2 is a route planner with a foreground GPS preview, NOT validated driving navigation.**

## Features

- Custom low-noise Glide vector map based on OpenFreeMap / OpenStreetMap, centered on Bucharest; no map API key required
- Destination lookup using TomTom Search
- Traffic-aware automobile routes with up to two alternatives, estimated duration and distance
- Significant traffic delays only, from TomTom vector `relative-delay` tiles: draw red below 35% and orange below 60% of free-flow speed; normal segments (including green) are never drawn
- Approximate Răzoare test origin, or a single browser GPS fix
- Mobile-friendly layout and manual route refresh
- High-contrast route line on an independent screen-space canvas; this remains on top of traffic as the map pans or zooms, with alternative routes
- Clickable turn instructions with maneuver map focus
- Foreground GPS following (explicit opt-in, preview only)
- Client-side TomTom API key entry; no key in Git history

**Not yet included:** map-matched live maneuver selection, automatic rerouting, validated driving navigation, voice prompts, verified lane directions or intersection diagrams. The location-following preview works only while the page remains active. The Răzoare demo origin is approximate and is not suitable for deciding which lane to drive in.

## Live site

GitHub Pages deployment is defined in `.github/workflows/pages.yml`.
After the workflow is enabled and succeeds, the expected address is:

https://razvanjuncu.github.io/laneform/

If needed, go to **Settings → Pages → Build and deployment**, select **GitHub Actions**.

## Development

Requires Node.js 24+.

```bash
npm install
npm run dev
```

Open the address Vite prints, typically http://localhost:5173. Enter your own TomTom API key in the app, with Assets API, Map Display API, Routing API, Search API, and Traffic API enabled. The key is not in the source.

The key is kept only in browser `sessionStorage` for the current tab. **It is not a secret once used by a browser:** it can still be seen in network requests. For deployed use, enable TomTom domain whitelisting for your actual site and monitor API usage. Do not commit keys or send them in messages.

Production caveats: provider quotas/terms apply, and a standalone GitHub Pages site cannot act as a private API proxy. Browser geolocation generally requires HTTPS and permission. iOS may suspend a web app in the background.

## No-budget usage safeguards

- The website never reconnects automatically on page refresh. Your key may be prefilled for the current browser tab, but you must press **Connect**.
- No extra tile-probe request is sent during connection. MapLibre loads only the actual viewport and does not automatically re-request expired tiles.
- Raster map tiles are capped at zoom 18; flow tiles at zoom 16.
- Traffic tiles are **lazy**: they are not fetched when merely connecting. They appear once you plan a route or explicitly opt in, at zoom 12+.
- The traffic layer uses TomTom's vector `relative-delay` tiles. The client filters speeds to less than 60% of free-flow (severe below 35%). Road closures, if included in the feed, are marked red. An unmarked road does **not** guarantee there is no congestion. Only tiles inside the current viewport are downloaded.
- Repeated destination searches are reused within the tab for 30 minutes. An identical route is reused for 2 minutes; explicit traffic refreshes are throttled for 2 minutes. New routing calls have a 12-second minimum gap.
- The UI shows its count of Search and Routing calls in this tab. **Map tile and traffic tile calls are not counted**; actual TomTom billing/quotas must be checked on the developer dashboard.
- No polling, automated route recalculation, or timer-based traffic refreshes. Optional tile refresh only occurs on an explicit route refresh and at least 5 minutes after the last traffic-tile update.
- Traffic snapshots can become stale. Refresh deliberately to see newer conditions; the app does not promise real-time continuous navigation.
- Tile calls may still happen on new zooms, pans, cache misses, reconnects, and browsing sessions. These safeguards limit unnecessary calls, but do not guarantee any fixed monthly allowance.

## Roadmap

- v0.2: clickable route instructions, high-contrast route polyline, foreground GPS following preview
- v0.3: destination suggestions, map-matched navigation progress and safer rerouting
- v0.3: OSM road- and lane-level graph, lane continuation/insertion/merge modeling, per-maneuver confidence
- v0.4: validated Drumul Sării → Bulevardul Geniului lane-alignment diagrams at Piața Danny Huwe/Răzoare
- Later: glanceable intersection glyphs, lane-aware routing preferences, iOS-specific improvements

**Safety rule:** do not infer unverified legal lane movements and display them as certain. Actual signs, markings and traffic signals take precedence.

## References

- https://docs.tomtom.com/maps-sdk-js/introduction/overview
- https://docs.tomtom.com/maps-sdk-js/guides/map/routes
- https://docs.tomtom.com/maps-sdk-js/examples/traffic-flow
- https://docs.tomtom.com/maps-sdk-js/api-reference/types/services.CostModel.html

## Glide visual identity (v0.3)

- Core: Obsidian `#0B0F12`, Deep Graphite `#12181D`, Gunmetal `#1C252B`, Steel Mist `#8C98A4`, Soft Silver `#D8E0E7`.
- Signature route / selected action: Signal Lime `#D7F36A`. Slowdown `#F3A94B`, severe or closure `#E55555`.
- Interface type: Inter Variable (Google Fonts with system-font fallback); large tabular ETA and legible touch targets.
- Motion: responsive, restrained 180–320 ms for controls/panels; route-camera ease around 470 ms; reduced-motion setting respected.
- Simplify details behind disclosure. Map and route are the hierarchy; minimal logo is typographic pending final user-supplied artwork.
- The initial dark map treatment applies low-saturation, reduced-brightness filters to TomTom's existing raster tiles. It is not yet a fully custom vector style with separately controlled roads and labels, which will be a later iteration.
- Independent canvas route overlay retains a native MapLibre route layer as a fallback. Actual route rendering must be tested with the user's TomTom key.

## Glide v0.4 — interactive route walkthrough

Once a route has been calculated, press **Explore route**. A simulated marker moves along its already-calculated geometry at an accelerated 12× speed. The HUD displays the next maneuver when route-offset guidance is available, remaining route distance, and estimated remaining travel time. Playback, pausing, and scrubbing use **no additional TomTom Routing or Search API calls**.

Camera following is off by default because moving the map can load additional tiles. The walkthrough is not live GPS navigation, does not simulate actual traffic, and is **not validated for active driving**. Live GPS follow remains a separate stationary-preview tool. Real map-matched navigation and lane-level instructions are not implemented yet.

## Glide v0.5 — distraction-free custom map

Glide's neutral map is now a **locally bundled vector style** (`src/glide-map-style.json`) using free OpenFreeMap / OpenStreetMap data. Road classes, colors, visibility at zoom levels, buildings and labels are styled independently. Unlike tinting TomTom raster screenshots, ordinary background roads and place names are intentionally low contrast. No POI icons or sprite request.

Source style inspiration: MIT-licensed `hyperknot/openfreemap-styles` dark style. Attribution remains visible on the map. OpenFreeMap hosts the map tiles and glyphs as a public community service; respect its policies and do not imply an SLA.

**TomTom is only used** when users explicitly request Search, Routing, or optional traffic tiles. Initial map display, panning, zooming, and route playback do **not** consume TomTom Map Display quota. A key restored from sessionStorage is configured locally without any network call.

If the public vector provider is unavailable, its road geometry may not render; the application should present a useful error rather than claim a complete map. Follow real road signs/markings and never rely on this prototype for driving.

## Glide v0.6 — automotive interface overhaul

This iteration replaces the permanent left-panel application with three explicit UI states:

- **Planning:** a small destination/search surface and origin selector over the full-screen map. TomTom API key and traffic controls live behind the top-right preferences button.
- **Preview:** a floating bottom sheet containing ETA, route distance, alternative route choices and an **Explore in 3D** action.
- **Simulated drive:** perspective camera (approx. 59° pitch), camera bearing aligned with the selected route, lower-third simulated position, a prominent next-maneuver HUD and a slim bottom progress strip. Play, pause, scrub and camera follow are available; scrubbing disables follow to avoid excessive tile downloads.

### Cartography and styling

Custom OpenFreeMap vector style uses cold obsidian-blue `#071018`, blue-green land and water, and muted silver-gray roads. Signal lime `#D7F36A` stays reserved for the selected trajectory and primary actions. The old black route casing has been replaced with a soft canvas glow, bright line core and faint inner highlight. Alternative routes are cool-gray and recessive.

### API budget protection

The map and camera animations consume **no TomTom Map Display requests**. OpenFreeMap tile traffic is separate from the TomTom API budget. TomTom Search and Routing are triggered only on deliberate route planning / manual traffic refresh; same-route reuse lasts 2 minutes, place reuse 30 minutes, and route API calls have a 12-second throttle. Route playback never calls TomTom. Optional live congestion overlay remains delayed/lazy.

### Safety and limitations

The immersive drive is **a route simulation, not real-time navigation**. It uses an estimated speed and instructions returned for the selected route, not live GPS, vehicle speed, road signs, or map matching. There is **no automatic rerouting**, validated lane-level positioning, or verified intersection diagram. The lane guidance container is explicitly hidden until verified source data becomes available, so the interface never invents lane directions. Do not operate or rely on this prototype while driving.

### Implementation files

- `index.html` — the three mode-specific surfaces.
- `src/style.css` — Glide's adaptive automotive design system.
- `src/main.js` — map, routing, route rendering and the simulation state machine.
- `src/glide-map-style.json` — locally bundled vector cartography.

The repo and GitHub Pages URL retain the development codename `laneform`. The product brand is Glide.

## Glide luxury direction — Satin Obsidian (locked for v0.7)

The brand follows the supplied custom GLIDE wordmark, rendered by a lightweight manually traced SVG (`glide-wordmark.svg`). The source artwork remains unchanged, while the SVG is an approximate UI derivative.

- Piano black `#050607`, obsidian charcoal `#0D1114`, graphite `#171C20`, satin silver `#C7CDD2` and platinum `#E7EAED`.
- No lime CTA or green brand coloring. The selected route has a 4.7 px platinum core and a minimal 7.5 px translucent halo; route alternatives fade into subdued steel gray.
- The vector map uses neutral silver roads, very dark water and graphite land, with modest label contrast. Muted red / amber congestion exceptions are opt-in from settings and require significant slowdowns.
- The compact preview card prioritizes destination, ETA and Preview. Alternative routes are available inside a collapsed disclosure, rather than three permanent large buttons.
- Inter remains the legible driving UI font. Less bold, less visual chrome and fewer repeated headings. Motion is damped and purposeful.
- Navigation mode remains a **simulation**, with no automatic rerouting or verified lane diagrams. Live driving use is not supported.
- Routing/Search calls are still user-initiated with short-term in-tab caches and request throttles. OpenFreeMap provides the base map.

The wordmark's geometry—not an oversized glow or bright accent—should define the brand identity.

## Interface v3 — Quiet Cockpit

Glide's UI now uses four separate modes: **Idle**, **Search**, **Preview**, and **Simulated Navigation**.

- **Idle:** the map and GLIDE logo remain dominant, with a single `Where to?` entry control at the bottom. No permanent origin selection or planning form.
- **Search:** a context-aware sheet opens; use the single search field and press Search/Enter to retrieve genuine TomTom place matches. A result selection immediately calculates a route. No network requests are triggered by typing or opening the sheet. Up to five recently routed places are stored only in browser-session storage.
- **Origin:** defaults to clearly identified `Răzoare · demo`. If location permission has already been granted, opening search can reuse device location. New permission requires choosing `Use my location`. A pending GPS fix blocks routing rather than silently using outdated positioning.
- **Preview:** destination and ETA sit in a small bottom sheet with one action. Route alternatives are collapsed and can be revealed when necessary.
- **Simulation:** perspective route camera, maneuver guidance and a restrained metrics bar. It remains **a simulation**, not live navigation, and is not approved for driving.

### Request budget and developer checks

Typing, local recent-place filtering, map movement and route playback do not issue TomTom Routing or Search requests. Destination search is explicitly submitted, uses a 30-minute in-memory cache and an 8-second repeat-request guard. A route is requested only when a returned/previous destination is selected, or through manual traffic refresh, with the prior 2-minute route cache and 12-second routing throttle. Search and route counters are retained for the browser tab. The base map continues using OpenFreeMap, not TomTom Map Display.

The repository includes `scripts/check-ui.mjs` structural tests, and the GitHub Pages workflow runs these checks before building. They cannot replace interactive testing with a user-owned TomTom key.

## Glide Interface v3.1 — Journey Pod

The route-preview screen has deliberately abandoned stacked information-card rows. It now consists of two separate map instruments: a rounded **journey pod** with destination, ETA, distance and a single **Start** action, plus an independent capsule **control dock** containing Routes, Traffic, and Overview. The optional route-choice tray rises above the pod; routes no longer fill a permanent subsection in the main surface.

- `Start` launches the existing **simulated** 3D route walkthrough; it is *not* a claim of road-ready GPS navigation. An accessibility label makes this explicit.
- The map's other controls now use circular and capsule geometry. Main pod radius is 34 px, secondary instruments 28 px, and buttons use full pill radii.
- Motion uses weighted, non-spring easing with 530–650 ms UI entrance and approximately 810–890 ms map camera movements, honoring reduced-motion preferences. Safety-relevant text updates remain immediate.
- TomTom usage is unchanged. The Routes tray only changes local UI state, and Traffic remains a manually initiated refresh. Route caching and throttling are retained.
- User-designed wordmark, Satin Obsidian color system and OpenFreeMap cartography are unchanged.

## Glide v3.2 — Quiet floating instruments

- **Idle map:** centered on the fallback Răzoare demo position, zoomed in and gently dimmed. When the browser already granted location permission, Glide fetches one GPS position and centers on it. It **never prompts for new location permission automatically on startup**. If the browser has not granted location, it stays on the named demo origin. Users may explicitly choose *Use my location* in Search.
- **Idle control:** the only primary action, `Where to?`, floats at the exact viewport center. It rises with an intentional ~830 ms animation, not a bounce.
- **All bubbles:** light outlines have been removed from floating surfaces and controls. Shapes use flat, deep-charcoal fills with a directional shadow and (only sometimes) an exceptionally faint platinum glimmer. Search, route, settings and maneuver surfaces have rounded capsule/pod silhouettes.
- **Maps:** conventional pin glyphs are replaced with a filled origin dot and a hollow platinum destination donut; current position has a softly haloed dot.
- **Start:** now only reads `Start`, no external-link arrow; still explicitly labeled *Start simulated navigation* for assistive technology. Does not initiate live GPS navigation.
- **Maneuver bubble:** removes the needless *Route simulation* header and decorative dot. Its width follows content within a safe maximum. The next maneuver retains legible distance and road instruction.
- **Motion:** softened center rise, weighted lateral glide and intentional camera motion (~930 ms), disabled for reduced-motion users. No additional TomTom calls.

## Glide v3.3 — centered destination search and path continuity

- The **entire destination selection flow** (search input, origin choice, results and recent places) sits in a content-sized centered bubble on desktop and mobile. The search bubble responds to `visualViewport` changes so the field moves into the visible portion of the screen when the phone's keyboard opens. Only the **route preview** uses the bottom journey pod/dock layout.
- After selecting a result, a weighted transition visually carries the new journey preview from the center down into its lower anchor. The effect is suppressed for reduced-motion users. Search remains explicit; tapping a result calculates the route using existing TomTom caching/throttling.
- Search result markers now use the same hollow **donut ring** as map destinations. Destination rings are reduced to 17px and route-origin dots to 11px with minimal halos, giving the markers equal visual weight.
- In simulated navigation the selected path is **split at the exact simulated vehicle position**. The portion behind it uses a muted gray line with no halo; only the untraveled portion keeps the restrained platinum glow. Scrubbing and camera-follow-off continue updating the split without any additional TomTom calls.
- `src/route-progress.js` is a pure geometry helper. Its split behavior is checked by `scripts/check-route-progress.mjs` in the existing GitHub Actions test pipeline.

This remains an experimental simulator, not live turn-by-turn or verified lane navigation.
