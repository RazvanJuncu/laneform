import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import { calculateRoute, discoverPlaces } from '@tomtom-org/maps-sdk/services';
import { Map as MapLibreMap, Marker, LngLatBounds, setWorkerUrl } from 'maplibre-gl';
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import glideMapStyle from './glide-map-style.json';
import './style.css';

// MapLibre 6 cannot locate its vector worker inside a Vite bundle by default.
setWorkerUrl(mapLibreWorkerUrl);

// Approximate test coordinate only, NOT a validated position in a particular lane.
const DEMO_ORIGIN = [26.061, 44.429];
const BUCHAREST = [26.1025, 44.4397];
const el = (id) => document.getElementById(id);
const ROUTE_TTL_MS = 2 * 60 * 1000;
const ROUTE_MIN_GAP_MS = 12 * 1000;
const TRAFFIC_REFRESH_MS = 5 * 60 * 1000;
const SEARCH_TTL_MS = 30 * 60 * 1000;
const TRAFFIC_MIN_ZOOM = 11;
const MOTION_MS = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 470;
const state = {
  map: null, ready: false, routes: null, destination: null, gps: null,
  marker: null, waypointMarkers: [], originMode: 'demo', busy: false,
  selected: 0, watchId: null,
  placeCache: new Map(), lastRouteSignature: null, lastRouteAt: 0,
  lastRouteAttemptAt: 0, trafficExplicit: false, lastTrafficAt: 0,
  requestCounts: { search: 0, route: 0 },
  routeCanvas: null, routeDrawScheduled: false, lastNativeRouteId: null,
  walkthrough: { active: false, playing: false, distance: 0, length: 0,
    points: [], cumulative: [], marker: null, raf: null, previousFrame: 0,
    lastCameraAt: 0, lastDisplayAt: 0 }
};
function normalizedQuery(query) {
  return query.trim().normalize('NFKC').toLocaleLowerCase('ro-RO').replace(/\s+/g,' ');
}
function coordinatesKey(coordinates) {
  return coordinates.map(value => Number(value).toFixed(4)).join(',');
}
function updateUsage() {
  const element = el('usage');
  if (element) element.textContent =
    'This tab: ' + state.requestCounts.search + ' searches · ' +
    state.requestCounts.route + ' route calls · map/traffic tiles not counted';
}
function countRequest(type) {
  state.requestCounts[type]++;
  try { sessionStorage.setItem('laneform.apiCounts', JSON.stringify(state.requestCounts)); }
  catch { /* browser storage unavailable */ }
  updateUsage();
}

function status(message, error = false) {
  el('message').textContent = message;
  el('message').classList.toggle('error', error);
}
function busy(value) {
  state.busy = value;
  el('plan').disabled = value;
  el('refresh').disabled = value;
  el('plan').textContent = value ? 'Planning your route…' : 'Plan journey ↗';
}
function time(seconds) { return String(Math.max(1, Math.round(seconds / 60))) + ' min'; }
function distance(meters) { return meters >= 1000 ? (meters / 1000).toFixed(1) + ' km' : Math.round(meters) + ' m'; }
function origin() { return state.originMode === 'gps' ? state.gps : DEMO_ORIGIN; }

// TomTom documented raster endpoint, rendered using independent MapLibre rather
// than the TomTom SDK's public-preview map/style wrapper.
// OpenFreeMap vector base map is key-free. Only routing/search/traffic use
// TomTom. Its focused style ships with the app, so there is no style fetch.
function openMapStyle() {
  return structuredClone(glideMapStyle);
}
function trafficTileURL(key) {
  return 'https://api.tomtom.com/traffic/map/4/tile/flow/relative-delay/{z}/{x}/{y}.pbf' +
    '?key=' + encodeURIComponent(key);
}
function setTrafficOverlay(enabled) {
  const map = state.map;
  if (!map || !state.ready || !map.getStyle()) return;
  const permitted = Boolean(enabled) && Boolean(state.routes || state.trafficExplicit) &&
    map.getZoom() >= TRAFFIC_MIN_ZOOM;
  const sourceId = 'laneform-traffic-vectors';
  const layerId = 'laneform-congestion-lines';
  if (!map.getSource(sourceId)) {
    if (!permitted) return;
    map.addSource(sourceId, {
      type: 'vector', tiles: [trafficTileURL(el('apiKey').value.trim())],
      minzoom: 0, maxzoom: 16
    });
    map.addLayer({
      id: layerId, type: 'line', source: sourceId, 'source-layer': 'Traffic flow',
      filter: ['any',
        ['==', ['get', 'road_closure'], true],
        ['all', ['has', 'traffic_level'],
          ['<', ['to-number', ['get', 'traffic_level'], 1], 0.6]]
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['case',
          ['==', ['get', 'road_closure'], true], '#E55555',
          ['<', ['to-number', ['get', 'traffic_level'], 1], 0.35], '#E55555',
          '#F3A94B'
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.4, 15, 4, 18, 5.5],
        'line-opacity': 0.86
      }
    });
    state.lastTrafficAt = Date.now();
    return;
  }
  const target = permitted ? 'visible' : 'none';
  if (map.getLayer(layerId) &&
      map.getLayoutProperty(layerId, 'visibility') !== target) {
    map.setLayoutProperty(layerId, 'visibility', target);
  }
}
function refreshTrafficTilesOnDemand() {
  const map = state.map;
  if (!map || !map.getSource('laneform-traffic-vectors') ||
      !el('trafficToggle').checked || map.getZoom() < TRAFFIC_MIN_ZOOM ||
      Date.now() - state.lastTrafficAt < TRAFFIC_REFRESH_MS) return;
  // Refresh only when explicitly requested. Never poll the provider.
  if (typeof map.refreshTiles === 'function') {
    map.refreshTiles('laneform-traffic-vectors');
    state.lastTrafficAt = Date.now();
  }
}
function connect() {
  // Purely local configuration: no TomTom network requests on connect.
  const key = el('apiKey').value.trim();
  if (!key) {
    status('Enter your TomTom API key to calculate routes.', true);
    return;
  }
  TomTomConfig.instance.put({ apiKey: key, language: 'en-GB' });
  try { sessionStorage.setItem('laneform.tomtom.key', key); }
  catch { /* browser storage disabled */ }
  el('setup').hidden = true;
  el('connection').textContent = 'READY';
  el('connection').classList.add('connected');
  status('Ready. Choose a destination.');
}
function initializeMap() {
  // The free OSM-based map starts independently of TomTom credentials and
  // makes zero TomTom requests until the user asks for a route.
  const map = new MapLibreMap({
    container: 'map',
    style: openMapStyle(),
    center: BUCHAREST, zoom: 12,
    maxZoom: 20,
    attributionControl: true,
    refreshExpiredTiles: false
  });
  state.map = map;
  prepareRouteCanvas();
  map.on('move', scheduleRouteDraw);
  map.on('resize', scheduleRouteDraw);
  map.on('moveend', () => {
    if (state.ready) setTrafficOverlay(el('trafficToggle').checked);
    scheduleRouteDraw();
  });
  map.on('style.load', () => {
    state.ready = true;
    el('planner').hidden = false;
    if (!el('apiKey').value.trim()) {
      el('connection').textContent = 'MAP READY';
      status('Map is ready. Add a routing key to calculate a journey.');
    } else {
      el('connection').textContent = 'READY';
      el('connection').classList.add('connected');
      status('Ready. Choose a destination.');
    }
    scheduleRouteDraw();
  });
  map.on('error', event => {
    // Tile failures should never freeze routing UI.
    console.warn('Glide base map issue:', event.error || event);
  });
}
function showGPS(position) {
  const point = [position.coords.longitude, position.coords.latitude];
  state.gps = point;
  if (state.map) {
    if (!state.marker) {
      const dot = document.createElement('div');
      dot.className = 'gps-dot';
      state.marker = new Marker({ element: dot }).setLngLat(point).addTo(state.map);
    } else {
      state.marker.setLngLat(point);
    }
    state.map.flyTo({ center: point, zoom: 15, duration: MOTION_MS });
  }
  status('GPS acquired (reported accuracy ±' + Math.round(position.coords.accuracy) + ' m).');
}
function locate() {
  if (!navigator.geolocation) { status('GPS not supported in this browser.', true); return; }
  status('Requesting location…');
  navigator.geolocation.getCurrentPosition(
    showGPS,
    (err) => status('Location unavailable: ' + err.message + '. Allow location access and use HTTPS.', true),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}
function setOrigin(mode) {
  state.originMode = mode;
  el('demoOrigin').classList.toggle('selected', mode === 'demo');
  el('gpsOrigin').classList.toggle('selected', mode === 'gps');
  if (mode === 'gps') locate();
  else status('Using approximate Răzoare demo start. This is not a verified driving position.');
}
function getSelectedRoute() { return state.routes?.features?.[state.selected]; }
// Routing SDK normally returns a GeoJSON LineString. MultiLineString is
// supported defensively for future providers, with independent segments.
function getRouteSegments(route) {
  const geometry = route?.geometry;
  if (!geometry) return [];
  if (geometry.type === 'LineString' &&
      Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2)
    return [geometry.coordinates];
  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates))
    return geometry.coordinates.filter(segment => Array.isArray(segment) && segment.length >= 2);
  return [];
}
function syncNativeRouteLayers() {
  const map = state.map;
  if (!map || !state.ready || !state.routes?.features?.length) return;
  const selected = state.routes.features[state.selected];
  const coords = getRouteSegments(selected);
  if (!coords.length) return;
  const geometry = coords.length === 1
    ? { type: 'LineString', coordinates: coords[0] }
    : { type: 'MultiLineString', coordinates: coords };
  const data = { type: 'Feature', properties: {}, geometry };
  const source = map.getSource('glide-native-route');
  if (source) source.setData(data);
  else map.addSource('glide-native-route', { type: 'geojson', data });
  if (!map.getLayer('glide-native-casing')) {
    map.addLayer({
      id:'glide-native-casing',type:'line',source:'glide-native-route',
      layout:{'line-cap':'round','line-join':'round'},
      paint:{'line-color':'#0B0F12','line-width':10,'line-opacity':0.95}
    });
    map.addLayer({
      id:'glide-native-line',type:'line',source:'glide-native-route',
      layout:{'line-cap':'round','line-join':'round'},
      paint:{'line-color':'#D7F36A','line-width':6,'line-opacity':1}
    });
  }
  state.lastNativeRouteId = selected.id || state.selected;
}
function fitRoute() {
  const segments = getRouteSegments(getSelectedRoute());
  if (!segments.length || !state.map) return;
  const bounds = new LngLatBounds();
  segments.forEach(segment => segment.forEach(coord => {
    if (Array.isArray(coord) && Number.isFinite(coord[0]) && Number.isFinite(coord[1]))
      bounds.extend(coord);
  }));
  state.map.fitBounds(bounds, {
    padding: { top: 86, right: 70, bottom: 115,
      left: state.walkthrough.active ? 70 : (window.innerWidth > 740 ? 425 : 70) },
    maxZoom: 16, duration: MOTION_MS
  });
}
// Independent screen-space overlay. Does not depend on map style / vector
// source load order, so congestion layers cannot cover or suppress the route.
function prepareRouteCanvas() {
  if (state.routeCanvas) state.routeCanvas.remove();
  const canvas = document.createElement('canvas');
  canvas.id = 'laneform-route-overlay';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: '2'
  });
  el('app').appendChild(canvas);
  state.routeCanvas = canvas;
}
function scheduleRouteDraw() {
  if (state.routeDrawScheduled) return;
  state.routeDrawScheduled = true;
  requestAnimationFrame(() => {
    state.routeDrawScheduled = false;
    drawRouteLines();
  });
}
function drawRouteLines() {
  const map = state.map, canvas = state.routeCanvas;
  if (!map || !canvas || !state.ready) return;
  const mapRect = map.getContainer().getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(mapRect.width * ratio));
  const height = Math.max(1, Math.round(mapRect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width; canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, mapRect.width, mapRect.height);
  if (!state.routes?.features?.length) return;
  const routes = state.routes.features;
  const selected = routes[state.selected];
  if (!getRouteSegments(selected).length) {
    console.warn('Unsupported route geometry:', selected?.geometry);
    return;
  }
  const trace = (route, color, lineWidth, opacity = 1) => {
    const segments = getRouteSegments(route);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = opacity;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const coordinates of segments) {
      ctx.beginPath();
      let started = false;
      for (const coord of coordinates) {
        if (!Array.isArray(coord) || !Number.isFinite(coord[0]) ||
            !Number.isFinite(coord[1])) continue;
        const point = map.project(coord);
        if (!started) { ctx.moveTo(point.x, point.y); started = true; }
        else ctx.lineTo(point.x, point.y);
      }
      if (started) ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  routes.forEach((route, index) => {
    if (index !== state.selected) trace(route, '#7C8791', 4, 0.66);
  });
  trace(selected, '#0B0F12', 13, 0.99);
  trace(selected, '#D7F36A', 7);
}
function instructionLabel(instruction) {
  if (instruction?.message) return instruction.message;
  const road = instruction?.nextRoadInfo?.streetName?.text;
  const maneuver = (instruction?.maneuver || 'CONTINUE').replaceAll('_',' ').toLowerCase();
  return maneuver.charAt(0).toUpperCase() + maneuver.slice(1) + (road ? ' onto ' + road : '');
}
function renderGuidance() {
  const container = el('guidanceSteps');
  container.replaceChildren();
  const list = getSelectedRoute()?.properties?.guidance?.instructions ?? [];
  el('guidanceCount').textContent = list.length ? list.length + ' steps' : 'Unavailable';
  for (const instruction of list) {
    if (!Array.isArray(instruction?.maneuverPoint)) continue;
    const row = document.createElement('button');
    row.type = 'button'; row.className = 'guidance-step';
    const at = document.createElement('span');
    at.className = 'step-distance';
    at.textContent = distance(instruction.routeOffsetInMeters || 0) + ' from start';
    const label = document.createElement('span');
    label.className = 'step-label'; label.textContent = instructionLabel(instruction);
    row.append(at,label);
    row.addEventListener('click', () => state.map?.flyTo({
      center: instruction.maneuverPoint, zoom: 16.5, duration: MOTION_MS
    }));
    container.append(row);
  }
  if (!container.childElementCount) {
    const empty = document.createElement('p');
    empty.className='helper'; empty.textContent='No turn-by-turn steps returned for this route.';
    container.append(empty);
  }
}
async function selectRoute(index) {
  if (!state.routes?.features?.[index]) return;
  state.selected = index;
  syncNativeRouteLayers();
  scheduleRouteDraw();
  renderGuidance();
  document.querySelectorAll('.route-choice').forEach((button, n) => {
    button.classList.toggle('selected', n === index);
  });
  const summary = state.routes.features[index].properties.summary;
  const box = el('routeSummary');
  box.replaceChildren();
  const main = document.createElement('strong');
  main.textContent = time(summary.travelTimeInSeconds);
  const details = document.createElement('span');
  const delaySeconds = Math.max(0, summary.trafficDelayInSeconds || 0);
  details.textContent = distance(summary.lengthInMeters) + (delaySeconds ? ' · ' + time(delaySeconds) + ' traffic delay' : ' · live traffic considered');
  box.append(main, details);
  fitRoute();
}

async function renderRoutes() {
  const container = el('routeChoices');
  container.replaceChildren();
  state.routes.features.forEach((route, index) => {
    const button = document.createElement('button');
    button.className = 'route-choice' + (index === 0 ? ' selected' : '');
    button.type = 'button';
    const label = document.createElement('span');
    label.textContent = index === 0 ? 'Recommended' : 'Alternative ' + index;
    const duration = document.createElement('strong');
    duration.textContent = time(route.properties.summary.travelTimeInSeconds);
    button.append(label, duration);
    button.addEventListener('click', () => selectRoute(index).catch((err) => status(err.message, true)));
    container.append(button);
  });
  el('results').hidden = false;
  await selectRoute(0);
}
async function planRoute(refresh = false) {
  if (state.busy || !state.ready) return;
  const key = el('apiKey').value.trim();
  if (!key) {
    el('setup').hidden = false;
    el('apiKey').focus();
    status('Add your TomTom key to calculate a route.', true);
    return;
  }
  TomTomConfig.instance.put({ apiKey: key, language: 'en-GB' });
  const start = origin();
  if (!start) { status('Wait for GPS, or choose the Răzoare demo starting point.', true); return; }
  const query = el('destination').value.trim();
  if (!refresh && !query) { status('Enter a destination.', true); return; }
  const now = Date.now();
  const signature = normalizedQuery(refresh ? state.lastRouteSignature?.split('|')[0] || query : query) +
    '|' + coordinatesKey(start);
  if (refresh && (!state.routes || !state.lastRouteSignature)) {
    status('Plan a route first, then refresh it.', true); return;
  }
  if (state.routes && signature === state.lastRouteSignature &&
      now - state.lastRouteAt < ROUTE_TTL_MS) {
    if (refresh) {
      const remaining = Math.ceil((ROUTE_TTL_MS - (now - state.lastRouteAt)) / 1000);
      status('Traffic checked recently. Refresh available in about ' + remaining + ' s.');
    } else {
      await renderRoutes();
      status('Reused the recent route without calling TomTom.');
    }
    return;
  }
  if (now - state.lastRouteAttemptAt < ROUTE_MIN_GAP_MS) {
    status('Rate limit: try again in ' +
      Math.ceil((ROUTE_MIN_GAP_MS - (now - state.lastRouteAttemptAt)) / 1000) +
      ' s to avoid excessive requests.');
    return;
  }
  state.lastRouteAttemptAt = Date.now();
  busy(true);
  status('Finding traffic-aware routes…');
  try {
    if (!refresh || !state.destination) {
      const key = normalizedQuery(query);
      const cached = state.placeCache.get(key);
      if (cached && Date.now() - cached.at < SEARCH_TTL_MS) {
        state.destination = cached.coordinates;
        status('Reused cached destination. Calculating traffic-aware route…');
      } else {
        const text = /bucurești|bucharest/i.test(query) ? query : query + ', București, Romania';
        countRequest('search');
        const results = await discoverPlaces({
          query: text, geoBias: { position: BUCHAREST }, limit: 5
        });
        const place = results.features?.[0];
        if (!place?.geometry?.coordinates) throw new Error('Destination not found. Try a precise address.');
        state.destination = place.geometry.coordinates;
        state.placeCache.set(key, { coordinates: state.destination, at: Date.now() });
        status('Found ' + (place.properties?.poi?.name ||
          place.properties?.address?.freeformAddress || query) + '. Calculating routes…');
      }
    }
    const locations = [start, state.destination];
    countRequest('route');
    const nextRoutes = await calculateRoute({
      locations, travelMode: 'car', maxAlternatives: 2,
      guidance: { type: 'coded' }, costModel: { routeType: 'fast', traffic: 'live' }
    });
    if (!nextRoutes?.features?.length) throw new Error('Routing returned no available route.');
    state.routes = nextRoutes;
    state.lastRouteSignature = signature;
    state.lastRouteAt = Date.now();
    state.selected = 0;
    syncNativeRouteLayers();
    scheduleRouteDraw();
    state.waypointMarkers.forEach((marker) => marker.remove());
    state.waypointMarkers = locations.map((coord, index) =>
      new Marker({ color: index === 0 ? '#D7F36A' : '#D8E0E7' })
        .setLngLat(coord).addTo(state.map)
    );
    await renderRoutes();
    // Route fitting fires 'zoomend'; request traffic tiles only for the final
    // viewport, rather than the full initial Bucharest overview.
    if (refresh) refreshTrafficTilesOnDemand();
    scheduleRouteDraw();
    status('Traffic-aware route ready. Tap a step to inspect a maneuver.');
  } catch (err) {
    console.error('Route planning failed:', err);
    status('Route failed: ' + (err?.message || 'unknown error') + '. Verify your Routing and Search API permissions.', true);
  } finally { busy(false); }
}

function stopGPSFollow() {
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
  el('followGPS').textContent = 'Follow GPS (preview)';
  el('followGPS').classList.remove('active');
  status('GPS preview stopped. Route still available.');
}
function toggleGPSFollow() {
  if (state.watchId !== null) { stopGPSFollow(); return; }
  if (!state.ready || !navigator.geolocation) {
    status('Connect map and permit access to your location.', true); return;
  }
  el('followGPS').textContent = 'Stop GPS follow';
  el('followGPS').classList.add('active');
  status('Foreground location preview active. Not validated for driving.');
  state.watchId = navigator.geolocation.watchPosition(
    (position) => {
      const point = [position.coords.longitude, position.coords.latitude];
      state.gps = point;
      if (!state.marker) {
        const dot=document.createElement('div');dot.className='gps-dot';
        state.marker=new Marker({element:dot}).setLngLat(point).addTo(state.map);
      } else state.marker.setLngLat(point);
      state.map.easeTo({center:point,zoom:Math.max(state.map.getZoom(),15),duration:MOTION_MS});
      el('gpsAccuracy').textContent='GPS accuracy ±'+Math.round(position.coords.accuracy)+' m';
    },
    (error) => { stopGPSFollow(); status('GPS unavailable: '+error.message,true); },
    {enableHighAccuracy:true,maximumAge:2500,timeout:12000}
  );
}

/* Route walkthrough: simulates a journey entirely from a route already
 * calculated in the browser. No new Routing or Search API requests. */
const SIMULATED_SPEED_MPS = (50 / 3.6) * 12;
function distanceBetween(a, b) {
  const r = 6371000, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const aa = Math.sin(dLat/2)**2 + Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dLon/2)**2;
  return r * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1-aa));
}
function buildWalkthroughPath(route) {
  const points = [];
  getRouteSegments(route).forEach(segment => segment.forEach(p => {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
    const prev = points[points.length-1];
    if (!prev || distanceBetween(prev,p) > 0.1) points.push(p);
  }));
  const cumulative = [0];
  for (let i=1;i<points.length;i++)
    cumulative.push(cumulative[i-1]+distanceBetween(points[i-1],points[i]));
  return {points,cumulative,length:cumulative[cumulative.length-1] || 0};
}
function pointAlongRoute(meters) {
  const w=state.walkthrough;
  if (w.points.length<2) return null;
  const d=Math.max(0,Math.min(w.length,meters));
  let lo=1,hi=w.cumulative.length-1;
  while(lo<hi) {
    const mid=(lo+hi)>>1;
    if(w.cumulative[mid]<d) lo=mid+1; else hi=mid;
  }
  const ix=Math.max(1,lo),a=w.points[ix-1],b=w.points[ix];
  const length=Math.max(0.01,w.cumulative[ix]-w.cumulative[ix-1]);
  const t=Math.max(0,Math.min(1,(d-w.cumulative[ix-1])/length));
  const coord=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  const bearing=Math.atan2((b[0]-a[0])*Math.cos(coord[1]*Math.PI/180),
    b[1]-a[1])*180/Math.PI;
  return {coord,bearing};
}
function refreshWalkthroughHUD() {
  const w=state.walkthrough;
  if(!w.active) return;
  const route=getSelectedRoute();
  const summary=route?.properties?.summary || {};
  const fraction=w.length?w.distance/w.length:0;
  const reportedLength=summary.lengthInMeters || w.length;
  const offset=reportedLength*fraction;
  const instructions=route?.properties?.guidance?.instructions || [];
  const next=instructions.find(x=>Number.isFinite(x.routeOffsetInMeters) &&
    x.routeOffsetInMeters>offset+10);
  el('navDistance').textContent=next
    ? distance(Math.max(0,next.routeOffsetInMeters-offset)):'Arriving';
  el('navInstruction').textContent=next
    ? instructionLabel(next):'Approaching your destination';
  el('navRemaining').textContent=distance(Math.max(0,reportedLength-offset))+' left';
  const seconds=(summary.travelTimeInSeconds || 0)*(1-fraction);
  el('navETA').textContent=seconds>1?Math.ceil(seconds/60)+' min estimated':'At destination';
  el('navScrub').value=String(Math.round(fraction*1000));
  el('navScrub').style.setProperty('--route-progress',(fraction*100).toFixed(1)+'%');
}
function updateWalkthrough(meters,immediate=false) {
  const w=state.walkthrough;
  if(!w.active) return;
  w.distance=Math.max(0,Math.min(w.length,meters));
  const point=pointAlongRoute(w.distance);
  if(!point) return;
  w.marker.setLngLat(point.coord);
  w.marker.setRotation(point.bearing);
  const now=performance.now();
  if(immediate || now-w.lastDisplayAt>85 || w.distance===w.length) {
    refreshWalkthroughHUD();
    w.lastDisplayAt=now;
  }
  if(el('navFollowCamera').checked &&
     (immediate || now-w.lastCameraAt>1100)) {
    state.map.easeTo({center:point.coord,zoom:15,duration:immediate?0:480});
    w.lastCameraAt=now;
  }
  if(w.distance>=w.length) pauseWalkthrough();
}
function pauseWalkthrough() {
  const w=state.walkthrough;
  w.playing=false;
  if(w.raf!=null) cancelAnimationFrame(w.raf);
  w.raf=null;w.previousFrame=0;
  el('navPlayPause').textContent=w.distance>=w.length?'Replay':'Play';
}
function walkthroughFrame(now) {
  const w=state.walkthrough;
  if(!w.active || !w.playing) return;
  if(w.previousFrame) {
    const seconds=Math.max(0,Math.min(0.12,(now-w.previousFrame)/1000));
    updateWalkthrough(w.distance+seconds*SIMULATED_SPEED_MPS);
  }
  w.previousFrame=now;
  if(w.playing) w.raf=requestAnimationFrame(walkthroughFrame);
}
function playWalkthrough() {
  const w=state.walkthrough;
  if(!w.active||w.playing)return;
  if(w.distance>=w.length) updateWalkthrough(0,true);
  w.playing=true;w.previousFrame=0;
  el('navPlayPause').textContent='Pause';
  w.raf=requestAnimationFrame(walkthroughFrame);
}
function startWalkthrough() {
  const route=getSelectedRoute();
  if(!state.ready || !route) return;
  const path=buildWalkthroughPath(route);
  if(path.points.length<2 || path.length<1) {
    status('This route has no usable line geometry for preview.',true);return;
  }
  if(state.watchId!==null)stopGPSFollow();
  const w=state.walkthrough;
  Object.assign(w,path,{active:true,playing:false,distance:0,raf:null,
    previousFrame:0,lastCameraAt:0,lastDisplayAt:0});
  const element=document.createElement('div');
  element.className='walkthrough-marker';
  w.marker=new Marker({element,rotationAlignment:'map'})
    .setLngLat(path.points[0]).addTo(state.map);
  state.waypointMarkers.forEach(marker=>{marker.getElement().style.display='none';});
  el('app').classList.add('walkthrough-mode');
  el('navHUD').hidden=false;
  el('navControls').hidden=false;
  el('navFollowCamera').checked=false;
  refreshWalkthroughHUD();
  fitRoute();
  // Intentionally start PAUSED; moving the camera is opt-in to save tiles.
}
function exitWalkthrough() {
  const w=state.walkthrough;
  if(!w.active)return;
  pauseWalkthrough();
  w.marker?.remove();w.marker=null;w.active=false;
  el('app').classList.remove('walkthrough-mode');
  el('navHUD').hidden=true;
  el('navControls').hidden=true;
  state.waypointMarkers.forEach(marker=>{marker.getElement().style.display='';});
  if(state.ready)fitRoute();
}
el('startWalkthrough').addEventListener('click',startWalkthrough);
el('navExit').addEventListener('click',exitWalkthrough);
el('navPlayPause').addEventListener('click',()=>{
  if(state.walkthrough.playing)pauseWalkthrough();else playWalkthrough();
});
el('navScrub').addEventListener('input',event=>{
  pauseWalkthrough();
  updateWalkthrough(state.walkthrough.length*Number(event.target.value)/1000,true);
});
el('navFollowCamera').addEventListener('change',event=>{
  if(event.target.checked)updateWalkthrough(state.walkthrough.distance,true);
  else fitRoute();
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden && state.walkthrough.playing)pauseWalkthrough();
});
el('connect').addEventListener('click', connect);
el('apiKey').addEventListener('keydown', (event) => { if (event.key === 'Enter') connect(); });
el('plan').addEventListener('click', () => planRoute());
el('destination').addEventListener('keydown', (event) => { if (event.key === 'Enter') planRoute(); });
el('refresh').addEventListener('click', () => planRoute(true));
el('demoOrigin').addEventListener('click', () => setOrigin('demo'));
el('gpsOrigin').addEventListener('click', () => setOrigin('gps'));
el('locate').addEventListener('click', locate);
el('fit').addEventListener('click', fitRoute);
el('followGPS').addEventListener('click', toggleGPSFollow);
el('trafficToggle').addEventListener('change', (event) => {
  if (event.target.checked) state.trafficExplicit = true;
  try { setTrafficOverlay(event.target.checked); }
  catch (err) { status('Traffic map layer unavailable: ' + err.message, true); }
});
// Restore credentials in-memory only. No request is sent to TomTom here.
try {
  const savedKey = sessionStorage.getItem('laneform.tomtom.key');
  if (savedKey) {
    el('apiKey').value = savedKey;
    el('setup').hidden = true;
    TomTomConfig.instance.put({ apiKey: savedKey, language: 'en-GB' });
  }
} catch { /* session storage disabled */ }
initializeMap();
try {
  const savedCounts = JSON.parse(sessionStorage.getItem('laneform.apiCounts') || 'null');
  for (const name of ['route', 'search']) {
    if (Number.isSafeInteger(savedCounts?.[name]) && savedCounts[name] >= 0)
      state.requestCounts[name] = savedCounts[name];
  }
} catch { /* unavailable counts */ }
updateUsage();
