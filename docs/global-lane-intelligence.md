# Glide / Global Lane Intelligence

**Scope:** Navigable road routes wherever the routing provider has coverage; anticipatory lane recommendations wherever sufficiently reliable lane data exists. This is a geographically neutral system — no special-case intersection or city database.

## Fundamental separation

1. **Route graph:** car-accessible OSM/TomTom network plus restrictions and routing. Works without any lane-level data.
2. **Lane evidence:** directional lane counts, `turn:lanes`, `change:lanes`, lane restrictions, `destination:lanes`, `placement`, `type=connectivity`, surveyed imagery or licensed HD-map data. Each source carries coverage, date, permitted use and reliability.
3. **Lane continuity graph:** a directed graph of lane segments, possible lane changes and legal junction connectors; intersections are a special type of connection, not the only place where lanes change. The goal is to recognize a lane becoming turn-only, ending, becoming restricted or splitting **before** the driver arrives.
4. **Prediction:** given the planned route, find upcoming lane events and propagate candidate lane choices backward across successive junctions. Include lead distance and confidence. Without defensible connectivity, describe *mapped arrows* only; do not imply a vehicle's lane or verified lane-to-lane continuation.
5. **Presentation:** one contextual lane instrument within Glide's map UI. It should appear with enough lead distance, not wait for a turn-by-turn instruction.

## Implemented: global lookahead alpha

- Searches no longer automatically append Bucharest to worldwide destination queries. Local ranking bias comes from GPS/map center.
- Same TomTom route request, with no additional TomTom calls, continues to provide route geometry and any provider lane recommendations.
- OSM request queries **the first ~3.7 km of the actual routed geometry**, sampled along the whole path rather than around TomTom instructions. It is 20 nearby-point queries in one bounded Overpass call, rate-limited and cached. It is **not** a worldwide HD-map service.
- `src/lane-lookahead.js` finds OSM tagged approach-way endpoints that line up with the routed path and derives its expected movement (straight or turn). If a straight-moving route approaches a left-only + straight + right-only marked intersection, it identifies the compatible straight-arrow lane, even if TomTom issues no turn.
- A route-distance timeline merges TomTom lane sections, instruction-associated OSM markings and corridor-detected OSM markings. TomTom provider recommendations take precedence near the same position.
- Guidance can appear **up to 1.1 km ahead** of an inferred event, and disappears after it has passed.
- All OSM results are labeled **unverified mapped markings**; roundabouts, U-turns, missing lane-arrow tags, conditional markings, ambiguous parallel highways and uncertain driving direction are excluded from this inference. No claim is made to know the current lane, legal lane changes or outgoing lane connections.
- Diagnostics report the scan window and whether additional journey segments are unscanned. A route with no lane data still functions as a road-level navigator/simulator.

## Next: global lane data platform

**Do not scale worldwide usage by sending arbitrary-length routes to public Overpass.** It is a public best-effort service. Replace the browser's direct OSM calls with a self-hosted or otherwise licensed server that indexes regional OSM extracts (and authorized supplemental providers) into route-corridor tiles. Keep lane data update timestamps and scan coverage.

Target processing model:

```text
route polyline --------------> corridor tile keys
                                   |
OSM planet/regional extracts -----+----> normalization / way direction / restrictions
surveyed imagery / official plans-+             |
commercial licensed datasets -----+----> lane evidence registry
                                                 |
                                   junction lane-connection inference
                                                 |
                                   independent confidence / conflict validation
                                                 |
                                   lane continuity graph (versioned)
                                                 |
route + graph --> candidate lane tracks --> lookahead advisories + uncertainty
```

A lane node should record jurisdiction and direction of travel, along-road offset, segment width/count if known, allowed movements, vehicle restrictions, source URL/ID, captured/verified dates and conflict flags. Edges should distinguish `continue`, `merge`, `split`, `turn` and `change-lane`, including where a change is legally prohibited. Special cases include reversible lanes, bus lanes, tidal flow, multilayer flyovers, roundabouts and roads with unclear markings.

### Global acceptance matrix

- **No annotated lanes:** route display works, lane overlay remains absent.
- **Straight with turn-only lane:** mark the straight-compatible painted arrows early; don't recommend left-only lane.
- **Road loses a lane without a turn:** show impending loss only with evidence about actual lane ending/continuing.
- **Two closely spaced junctions:** lane path based on connectivity/verified graph rather than isolated turn arrows.
- **Left-hand traffic:** preserve lane ordering in travel direction and restrictions for jurisdiction.
- **Complex multilayer interchange:** do not match nearby parallel roads solely by GPS proximity.
- **Conditional/reversible lanes:** no recommendations until rules can be evaluated for date/time/vehicle.
- **Stale/contradictory data:** drop back to road-level turn guidance and surface uncertainty.
- **Dateline/high-latitude routes:** require robust geographic projection tests beyond this alpha.

## Current limitations

The first 3.7 km OSM scan is a **prototype budget/safety guard**, not full-route lane coverage. Route following remains simulated; no high-integrity GPS map matching or automatic rerouting exists. OSM tagged road ends do **not** prove a legal junction or exact lane connection. The initial algorithm infers ahead-of-road arrows; it cannot yet solve every intersection. Worldwide lane completeness is not available from a single open source.

Tests are synthetic geometry regressions, not field verification. Never use Glide's alpha lane arrows as authoritative instructions while driving.

## Sources / technical references

- https://wiki.openstreetmap.org/wiki/Key:turn
- https://wiki.openstreetmap.org/wiki/Lanes
- https://wiki.openstreetmap.org/wiki/Relation:connectivity
- https://docs.tomtom.com/maps-sdk-js/guides/core/utilities/routes
- https://download.geofabrik.de/
