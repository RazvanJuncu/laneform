> **Glide's development target is global.** Road routing should be available wherever
> TomTom and map data support it; lane assistance should anticipate upcoming
> turn-only lanes, lane endings, merges, and junctions. In the current alpha,
> only evidence-backed lane markings are shown. See
> [Global Lane Intelligence](docs/global-lane-intelligence.md) for the engine,
> staged geographic coverage and validation requirements.

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

## Lane Assist alpha — provider-backed initial integration

This is a first working **data integration**, not yet Glide's full multi-intersection lane-continuity engine.

The routing request already asks for `guidance:{type:'coded'}` using TomTom's Maps SDK for JavaScript. According to TomTom's SDK docs, `calculateRoute` includes `sections.lanes` when supported by the backend, and `getInstructionLanes(route,instruction)` associates a section with the relevant maneuver. **We read those same already-requested route results** and do not issue any additional requests for lane assistance.

The pure normalizer lives in `src/lane-assist.js`. It validates provider-reported directions and any `follow` recommendation. If no actual recommended lane exists or the SDK helper cannot return usable data, we display **no lane diagram** and revert to normal guidance. The UI only shows source-backed lane-arrow recommendations near the upcoming maneuver (within 480 m and before 12 m). It does not infer or claim the driver's present lane, legally permitted lane changes, or which exact lane a turn feeds into.

The Diagnostics drawer exposes `TomTom lane sections: X of Y instructions` for the selected route. This is a coverage diagnostic, not a measure of on-road correctness. Open it after planning routes through Răzoare to see if provider recommendations are present. **TomTom Orbis routing v3 does not provide lanes sections**, so actual coverage depends on which routing backend the active SDK request uses.

Next, we can construct a separate versioned lane-connection graph from OSM tags (`turn:lanes`, `lanes:forward`) and connectivity relations, with field verification for the precise Drumul Sării → Piața Danny Huwe → Bulevardul Geniului corridor. An inferred connection must never be silently treated as verified. The advanced through-intersection path should only appear when the underlying directed lane graph is sufficiently reliable.

Tests: `scripts/check-lane-assist.mjs` checks normalizing, missing data, offsets, and safe fallback. Lane recommendations are for stationary simulation/inspection only until the system is fully validated. Do not use Glide as driving navigation.

## Arrival instruction regression fix and discoverable lane coverage

When TomTom returns an upcoming arrival instruction and there are no other turns
remaining, the navigation HUD **must not** display a past-tense "you have
reached your destination" message while kilometres away. Glide now uses
`src/maneuver-guidance.js` to select the next actionable maneuver, with
`Continue toward destination` as its long-distance fallback. The last 75 m
shows "Destination ahead", and the completed state is shown only when route
progress has actually reached the destination. This is validated by
`scripts/check-maneuver-guidance.mjs`, including the reported 3.1 km case.

The route-preview pod now displays either **Lane assist available at N
maneuvers** or **Lane assist unavailable on this route**. The Preferences →
Technical details breakdown distinguishes raw TomTom lane sections from usable
recommendations. This matters because some TomTom routing backends and areas
provide no lane sections: the code won't fabricate lanes to fill the gap.
Single-lane provider sections are accepted for normalization, although the
multi-lane intersection model remains a future milestone.

These changes read only the previously requested route. No extra API calls are
made. Do not use the simulated guidance for real-world driving.

## Multi-source Lane Intelligence — TomTom + OpenStreetMap alpha

**Purpose:** The first Bucharest route test returned 0 of 14 TomTom lane sections, despite several complex intersections. Lane assistance no longer relies on a single provider.

- **TomTom:** Guided routes are still authoritative for *where to go*, and the SDK's `getInstructionLanes` supplies recommended lanes wherever the routing backend returns lane sections.
- **OpenStreetMap:** After the user deliberately calculates a route, a single small, bounded **Overpass** query collects `turn:lanes`, `turn:lanes:forward` and `turn:lanes:backward` from road segments near up to 16 upcoming maneuvers. Geometry is matched to the actual approach within 9 m and 22° before any arrows can be shown. Direction-dependent tags, oneway direction, unknown markings, roundabout ambiguity and competing parallel roads are handled conservatively.
- **Precedence:** Genuine TomTom *recommendations* take priority over OSM turn markings. OSM arrows are labeled **Mapped turn arrows · OSM (unverified)**. They show mapped road paint for the desired direction; they are **not** verified lane-to-lane transitions or proof of legal lane access. Unknown/mismatched data remains hidden.
- **Coverage:** The route preview and Preferences show separate TomTom and OSM matches. Public Overpass downtime or missing mapping is shown plainly. Never replace a missing result with fabricated lanes.
- **Privacy / budget:** One query per newly calculated route after route planning, limited to 16 maneuver neighborhoods, cached for 20 minutes per route in memory and globally throttled to one request per 30 seconds. The request sends nearby maneuver coordinates to `overpass-api.de` but never sends the TomTom key. No additional TomTom calls and no lookup while panning, scrubbing, or simulating. Public Overpass is shared, best-effort and may time out.
- **Testing:** `scripts/check-osm-lanes.mjs` exercises geometry matching, left/right directions, oneway backward tagging, ambiguity rejection and no-data fallback. A green build **does not verify real OSM coverage or live Overpass availability**.

**Next step:** The actual distinctive Glide feature is a field-checked directed lane graph across Piața Danny Huwe/Răzoare and other selected complex junctions. OSM `type=connectivity` relations, aerial imagery and on-site road markings can help construct that graph, but they must be reconciled manually when incomplete or contradictory. Ordinary GPS does not determine the current traffic lane. Until independently verified, never present *mapped arrows* as confirmed intersection lane-continuity guidance. This prototype is not for actual driving.

## Route-order safety gate for lane assistance

Regression found during a simulated Bucharest route: the HUD showed an upcoming **left
turn in 252 m**, while a TomTom lane event for a **later right turn in 653 m**
highlighted the right-turn lane. The display was misleading: the standalone
lane-event lookahead was unaware of intervening turn instructions.

The safety gate in `src/lane-lookahead.js` now:

- Treats the next actual TomTom maneuver as a hard ordering barrier. Lane
  recommendations for intersections **after** that turn stay hidden until the
  earlier turn is completed.
- Rejects a lane provider's recommended turn direction when it conflicts with
  the corresponding immediate maneuver (e.g. RIGHT-only advice for LEFT).
- Avoids showing guidance for the next maneuver during the first 40 m after a
  direction-changing turn, when route offsets may already have switched to the
  following instruction but the driver is still completing the intersection.
- Continues allowing eligible mapped road markings for earlier junctions
  **before** the next turn, where sufficient data exists, and does not query
  external APIs for these safety checks.

This is a **fail-closed guard**, not proof that the chosen lane before a turn
remains suitable for the following turn. True optimal lane selection through
closely spaced junctions requires the directed lane-continuity graph and
reliable legal/restriction information. Until such coverage is available, the
UI must suppress conflicting or distant recommendations rather than claiming
a verified path. A regression test reproduces the exact 252 m left / 653 m
right sequence.

## OSM lookup reliability / coverage diagnostics

A real route returned TomTom lane recommendations for 3/15 instructions while the
public Overpass lookup was unavailable. That is a data-acquisition failure,
**not evidence that OSM has zero mapped lane annotations**.

The prototype now:
- Uses **one Overpass linestring proximity filter** following the first 3.7 km
  of the route, replacing the original 20 overlapping `around` way filters.
  This query shape is documented by Overpass QL and conserves server work.
- Uses public **Private.coffee Overpass** with OSM Germany as a secondary
  fallback for network errors, timeouts and HTTP 502/503/504 only. It never
  hops to another server after HTTP 429 (rate limit) or 400 (bad query).
  Both are best-effort shared public services, not a production SLA.
- Preserves the in-tab 20-minute successful cache, a 2-minute failed-result
  cache, 30-second minimum interval between separate lookups, max two
  endpoints per explicit request and no per-frame polling. A manual **Retry
  OSM lookup** button appears only when the optional data lookup fails/is
  deferred, and honors the cooldown. No additional TomTom requests.
- Shows **TomTom lane-enabled maneuvers** separately from raw returned
  sections. When OSM fails, displays **NOT CHECKED** plus the reason. Only
  after a successful OSM response will it show numbers for downloaded
  tagged ways and route-matched lane events.
- Shows which public Overpass instance answered a successful query and
  the length of the initial route section actually scanned. This prevents
  interpreting a partial scan as complete worldwide coverage.
- Keeps source confidence conservative: no data results in no new
  suggestions, and OSM turn-arrow markings are not confirmed lane
  connectivity. The application is still a stationary simulator.

`scripts/check-osm-source.mjs` uses mock network responses to verify
Overpass query structure, transient failover, HTTP 429/400 non-failover and
the distinction between a successful zero-result scan and service failure.
It does not prove browser CORS, live availability, or the mapping completeness
of an actual road corridor.

**Scale requirement:** Replace direct public Overpass queries with a
self-hosted regional/global lane-data index (OSM extracts, diffs, licensed
imagery and road authority information). Public shared endpoints aren't
suitable for global turn-by-turn lane guidance at scale.


## Experimental lane geometry integration

An optional **Street geometry lab** in Preferences lazily loads the real osm2streets WebAssembly engine to reconstruct and overlay lane shapes from small OSM XML extracts. It makes no additional TomTom calls and never promotes reconstructed polygons into authoritative lane advice. See [integration guide](docs/osm2streets-integration.md).

## Integrated progressive junction detail

Glide no longer exposes the previous manual geometry lab in Preferences.
Instead the route simulator prepares the **next routed junction** ahead of time:
one small OpenStreetMap map extract, locally reconstructed by the pinned
osm2streets WebAssembly engine, then cached in memory for nearby preview.

If the schematic data is ready, a near-junction view engages about 270 m
before that maneuver. The driver can explicitly inspect/exit using the
**Junction detail** control, zoom in near the junction or zoom out to dismiss
the detail for that junction. Map gestures suspend automatic camera follow
so the view does not fight a pinch/wheel gesture. After crossing, Glide
advances to the next routed turn and prepares it after a 30-second
request cooldown. No per-frame requests. At most one in-flight area
request and five cached results; no new TomTom API calls.

This prototype only seeds targets from routed turn instructions, not
every unannounced straight-through junction or lane split; worldwide
intersection discovery requires a pre-indexed road graph. Data access
to the public OSM API is not guaranteed. If a scan fails, Glide
retains normal routing guidance and never displays a fabricated diagram.
Reconstructed lanes are **not verified lane-to-lane connectivity**.
The prior full-route public Overpass lookup is no longer automatically
launched by route planning.

The system remains a stationary simulation, not safe for actual driving.

## Selective junction geometry / route proximity visualization

As the next visual refinement of the contextual junction preview,
`src/junction-focus.js` classifies osm2streets geometry relative to a
330-metre window of the actual TomTom route around the next maneuver:

- Lane **polygon centroids within 22 m** of the route geometry are
  *visually emphasized* in muted silver-steel; other reconstructed roads
  remain dim contextual shapes. Nearby road markings within 20 m are
  shown without rendering all unrelated arrows.
- The route itself remains the original TomTom polyline. In detailed
  junction mode it uses a thinner silver trace with almost no glow and
  a muted trail behind the simulated vehicle.
- No additional data requests are made. Geometry classification happens
  once after preparing each junction and is cached.
- Matching a polygon by proximity is not identifying the correct driving
  lane or verifying whether a specific lane can turn into an exit lane.
  Therefore **none of the reconstructed polygons modify navigation
  instructions or lane recommendations**. They are schematic context
  to make junction layouts legible.

A complete global lane continuity graph must eventually reconcile
legal road-to-lane connectivity, turning restrictions, lane-end merges
and trustworthy source confidence before any lane-level path can be
offered as instruction. The preliminary focus is deliberately only
a display-level spatial match.

Tests: `scripts/check-junction-focus.mjs` validates emphasis,
background filtering, near-route markings, missing route and source
immutability.

## Traffic API usage guard

The TomTom dashboard reported about 8.1K aggregated API requests for a week of
prototype development. This **does not identify** which API category generated
those calls or imply that all were routing requests or billable requests.
TomTom accounts for traffic vector tiles, map tiles, routing, search and
other endpoints individually; inspect the dashboard's API usage breakdown.

The current Glide base map is served exclusively from **OpenFreeMap**.
TomTom provides destination search, traffic-aware route calculation, and one
optional visual overlay. MapLibre's traffic source used to remain live during
camera pans, zooms and simulation if the toggle was enabled, multiplying
metered vector tile requests.

The new guard keeps traffic vector tiles **opt-in and preview-only**:
- They are not loaded merely by opening Glide or selecting a destination.
- The traffic tile source and style layer are **removed**, not only hidden,
  whenever the toggle is off, the user leaves route preview, the camera zoom
  exceeds level 15, or the tab's request guard has been exhausted.
- Entering simulation clears the traffic tile checkbox. The computed route's
  ETA and traffic-aware routing do **not** change.
- MapLibre `transformRequest` conservatively counts TomTom traffic tile
  attempts (not all network requests and not necessarily chargeable requests)
  in `sessionStorage`. After **80 requests initiated in that tab**, further
  TomTom traffic tile URLs are replaced with an empty local vector-tile
  response and the map source is detached. Counts persist across refreshes of
  the same tab. New tabs reset this limit, so this is **not** an account-wide
  quota control.
- The Preferences panel shows the count and guard status. Glide's separate
  search and route counters are also session-local. The official dashboard
  remains the only source for actual billed totals.
- Underlying TomTom route calls only happen after a selected destination or
  explicit route recalculation; place searches are cached and not triggered
  for every keystroke.

The cap is a local prototype safeguard. Production would need server-side
per-user/account quotas, map traffic aggregation or tiled CDN policy, API-key
restrictions, and centralized usage and billing alerts.

Source: https://docs.tomtom.com/pricing and
https://docs.tomtom.com/platform/documentation/status-and-support/faqs

## Junction rendering: replaced basemap roads + provisional lane traces

The detailed geometry mode now **removes the original OpenFreeMap
transportation line layers** (`highway_*` drawn from vector tiles) while
osm2streets' lane polygons/markings are visible. It leaves other map layers
(buildings, greenspace, water, place labels and street names) intact and
restores the exact original road-layer visibility upon exit, style change
or route-state transition. This is visual switching, not a tile-source
reload or additional API request.

`src/lane-path-candidates.js` starts the route-to-lane association needed
for proper future lane paths:
- osm2streets' **lane polygons** are enriched with road ID, lane index,
  lane type, and `allowed_turns` metadata;
- only `Driving` lane polygons whose mapped turn markings match the
  next actual TomTom maneuver are considered;
- locally perpendicular route cross-sections reconstruct a *provisional
  center trace* inside a matching lane polygon; at least four consecutive
  samples (approximately 27 metres) are necessary;
- nearby unrelated roads, bus-only lanes, missing/contradictory turn
  markings, very wide lane intervals and ambiguous large candidate sets
  do not create lane traces;
- **candidate traces stop roughly 22 metres before the intersection**.
  They are dashed steel-blue; the original TomTom road-centerline becomes
  subdued while alternatives are visible. No invented lane connector is
  drawn through the junction.

These paths are **geometry and marking hypotheses, not safe lane
recommendations**. OSM may have stale, incorrect or missing lane tags.
The next work item is to align street-network road direction, verify
possible lane-to-lane movement connectivity and restrictions, and
propagate admissible lane choices across consecutive intersections.

No additional TomTom or OSM network calls were added. Candidate paths are
calculated once from already reconstructed cached geometry.

Regression coverage: `scripts/check-lane-traces.mjs`.
