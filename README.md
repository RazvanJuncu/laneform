# Glide — Navigation, refined.

Glide is the visual brand. The GitHub repository and developer identifiers remain named Laneform to preserve deployment URLs and stored preferences. Personal-use navigation research prototype for Bucharest. **v0.2 is a route planner with a foreground GPS preview, NOT validated driving navigation.**

## Features

- TomTom interactive dark map, centered on Bucharest
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
