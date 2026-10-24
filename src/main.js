import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import { TomTomMap, RoutingModule, TrafficFlowModule } from '@tomtom-org/maps-sdk/map';
import { calculateRoute, discoverPlaces } from '@tomtom-org/maps-sdk/services';
import { Marker, LngLatBounds } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

// Approximate test coordinate only, NOT a validated position in a particular lane.
const DEMO_ORIGIN = [26.061, 44.429];
const BUCHAREST = [26.1025, 44.4397];
const el = (id) => document.getElementById(id);
const state = { map: null, routing: null, traffic: null, routes: null, destination: null, gps: null, marker: null, originMode: 'demo', busy: false, selected: 0 };

function status(message, error = false) {
  el('message').textContent = message;
  el('message').classList.toggle('error', error);
}
function busy(value) {
  state.busy = value;
  el('plan').disabled = value;
  el('refresh').disabled = value;
  el('plan').textContent = value ? 'Calculating…' : 'Find route ↗';
}
function time(seconds) { return String(Math.max(1, Math.round(seconds / 60))) + ' min'; }
function distance(meters) { return meters >= 1000 ? (meters / 1000).toFixed(1) + ' km' : Math.round(meters) + ' m'; }
function origin() { return state.originMode === 'gps' ? state.gps : DEMO_ORIGIN; }

async function connect() {
  const key = el('apiKey').value.trim();
  if (!key) { status('Enter your TomTom API key.', true); return; }
  el('connect').disabled = true;
  status('Starting map…');
  try {
    TomTomConfig.instance.put({ apiKey: key, language: 'en-GB' });
    if (state.map?.mapLibreMap) state.map.mapLibreMap.remove();
    state.map = new TomTomMap({
      style: 'drivingDark',
      mapLibre: { container: 'map', center: BUCHAREST, zoom: 12, attributionControl: true }
    });
    state.routing = await RoutingModule.create(state.map);
    try {
      state.traffic = await TrafficFlowModule.get(state.map, { visible: el('trafficToggle').checked });
    } catch (err) {
      console.warn('Traffic overlay unavailable:', err);
      status('Map ready; traffic overlay is unavailable. Routing can still use live traffic.');
    }
    // Key is only saved in this browser tab, never bundled into GitHub files.
    try { sessionStorage.setItem('laneform.tomtom.key', key); } catch { /* storage disabled */ }
    el('setup').hidden = true;
    el('planner').hidden = false;
    el('connection').textContent = 'CONNECTED';
    el('connection').classList.add('connected');
    status('Map ready. Try Piața Victoriei as a destination.');
  } catch (err) {
    console.error('Could not start map:', err);
    status('Map startup failed: ' + (err?.message || 'unknown error') + '. Verify key access to Map Display and Assets APIs.', true);
    state.map = null;
    state.routing = null;
  } finally {
    el('connect').disabled = false;
  }
}

function showGPS(position) {
  const point = [position.coords.longitude, position.coords.latitude];
  state.gps = point;
  if (state.map?.mapLibreMap) {
    if (!state.marker) {
      const dot = document.createElement('div');
      dot.className = 'gps-dot';
      state.marker = new Marker({ element: dot }).setLngLat(point).addTo(state.map.mapLibreMap);
    } else {
      state.marker.setLngLat(point);
    }
    state.map.mapLibreMap.flyTo({ center: point, zoom: 15 });
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
function fitRoute() {
  const coordinates = getSelectedRoute()?.geometry?.coordinates;
  if (!coordinates?.length || !state.map?.mapLibreMap) return;
  const bounds = new LngLatBounds();
  coordinates.forEach((coord) => bounds.extend(coord));
  state.map.mapLibreMap.fitBounds(bounds, {
    padding: { top: 100, right: 60, bottom: 100, left: window.innerWidth > 700 ? 455 : 45 },
    maxZoom: 16, duration: 650
  });
}
async function selectRoute(index) {
  if (!state.routes?.features?.[index]) return;
  state.selected = index;
  await state.routing.selectRoute(index);
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
  if (state.busy || !state.routing) return;
  const start = origin();
  if (!start) { status('Wait for GPS, or choose the Răzoare demo starting point.', true); return; }
  const query = el('destination').value.trim();
  if (!refresh && !query) { status('Enter a destination.', true); return; }
  busy(true);
  status('Finding traffic-aware routes…');
  try {
    if (!refresh || !state.destination) {
      const text = /bucurești|bucharest/i.test(query) ? query : query + ', București, Romania';
      const results = await discoverPlaces({ query: text, geoBias: { position: BUCHAREST }, limit: 5 });
      const place = results.features?.[0];
      if (!place?.geometry?.coordinates) throw new Error('Destination not found. Try a precise address.');
      state.destination = place.geometry.coordinates;
      const placeName = place.properties?.poi?.name || place.properties?.address?.freeformAddress || query;
      status('Found ' + placeName + '. Calculating routes…');
    }
    const locations = [start, state.destination];
    state.routes = await calculateRoute({
      locations, travelMode: 'car', maxAlternatives: 2,
      guidance: { type: 'coded' }, costModel: { routeType: 'fast', traffic: 'live' }
    });
    if (!state.routes?.features?.length) throw new Error('Routing returned no available route.');
    await state.routing.showRoutes(state.routes);
    await state.routing.showWaypoints(locations);
    await renderRoutes();
    status('Routes use live traffic at calculation time. GPS tracking and rerouting are not implemented yet.');
  } catch (err) {
    console.error('Route planning failed:', err);
    status('Route failed: ' + (err?.message || 'unknown error') + '. Verify your Routing and Search API permissions.', true);
  } finally { busy(false); }
}

el('connect').addEventListener('click', connect);
el('apiKey').addEventListener('keydown', (event) => { if (event.key === 'Enter') connect(); });
el('plan').addEventListener('click', () => planRoute());
el('destination').addEventListener('keydown', (event) => { if (event.key === 'Enter') planRoute(); });
el('refresh').addEventListener('click', () => planRoute(true));
el('demoOrigin').addEventListener('click', () => setOrigin('demo'));
el('gpsOrigin').addEventListener('click', () => setOrigin('gps'));
el('locate').addEventListener('click', locate);
el('fit').addEventListener('click', fitRoute);
el('trafficToggle').addEventListener('change', (event) => {
  try { state.traffic?.setVisible(event.target.checked); }
  catch (err) { status('Traffic map layer unavailable: ' + err.message, true); }
});
try {
  const saved = sessionStorage.getItem('laneform.tomtom.key');
  if (saved) { el('apiKey').value = saved; connect(); }
} catch { /* session storage disabled */ }
