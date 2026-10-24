# Laneform — Bucharest Navigation Lab

Personal-use navigation research prototype for Bucharest. **v0.2 is a route planner with a foreground GPS preview, NOT validated driving navigation.**

## Features

- TomTom interactive dark map, centered on Bucharest
- Destination lookup using TomTom Search
- Traffic-aware automobile routes with up to two alternatives, estimated duration and distance
- Live traffic flow map overlay (where supported)
- Approximate Răzoare test origin, or a single browser GPS fix
- Mobile-friendly layout and manual route refresh
- High-contrast route line with casing above traffic tiles and alternate routes
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
