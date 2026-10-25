import { TomTomConfig, getInstructionLanes } from '@tomtom-org/maps-sdk/core';
import { calculateRoute, discoverPlaces } from '@tomtom-org/maps-sdk/services';
import { Map as MapLibreMap, Marker, LngLatBounds, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import mapStyle from './glide-map-style.json';
import { splitPathByDistance } from './route-progress.js';
import { extractRouteLaneGuidance, upcomingLaneGuidance, LANE_ARROWS } from './lane-assist.js';
import { nextManeuverState, arrivalApproachText } from './maneuver-guidance.js';

import { deriveOsmLaneRecords } from './osm-lane-geometry.js';
import { laneEventsFromCorridor, buildLaneTimeline, chooseLaneLookahead }
  from './lane-lookahead.js';
import {createJunctionDetail} from './junction-detail.js';
import {MAX_TRAFFIC_TILE_ATTEMPTS,EMPTY_TRAFFIC_TILE,isTomTomTrafficTile,
  trafficTileBudget} from './traffic-budget.js';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

setWorkerUrl(workerUrl);

const $ = id => document.getElementById(id);
const BUCHAREST = [26.1025, 44.4397];
const DEMO_ORIGIN = [26.061, 44.429]; // Approximate, not lane-verified.
const SIGNAL = '#E7EAED';
const ROUTE_HALO = '#AEBAC4';
const ROUTE_TTL = 120000;
const SEARCH_TTL = 1800000;
const REQUEST_GAP = 12000;
const SEARCH_GAP = 8000;
const RECENT_LIMIT = 5;
const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOTION = isReducedMotion ? 0 : 930;
let junctionDetail=null;
const state = {
  map: null, mapReady: false, mode: 'idle',
  key: '', query: '', destinationName: '', destination: null,
  originMode: 'demo', gps: null, gpsAt: 0, gpsMarker: null, originRequestId: 0, initialLocationChecked: false,
  routes: null, selected: 0, busy: false, routeMarkers: [],
  searchCache: new Map(), routeSignature: '', routeAt: 0, attemptAt: 0,
  lastSearchAt: 0, recents: [], searchMatches: [],
  calls: { search: 0, route: 0 }, trafficAvailable: false, lastTrafficAt: 0,
  trafficTileAttempts: 0, trafficBudgetTimer: null,
  laneCache: new WeakMap(),
  osmCache: new WeakMap(),
  corridorCache: new WeakMap(), timelineCache: new WeakMap(),
  osmWays: [], osmStatus: 'not-checked', osmRequestId: 0, osmChecked: 0,
  osmCoverageMeters: 0, osmRawWays: 0, osmProvider: '',
  osmFailure: '', osmFailureKind: '', osmRetryAfter: 0,
  drawQueued: false, toastTimer: null,
  sim: { active: false, playing: false, follow: true, raf: null,
    lastFrame: 0, lastCamera: 0, marker: null,
    points: [], cumulative: [], length: 0, distance: 0 }
};

function toast(message, error = false) {
  const node = $('toast');
  node.textContent = message;
  node.classList.toggle('error', error);
  node.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { node.hidden = true; }, error ? 6500 : 3700);
}
function uiBusy(value) {
  state.busy = value;
  $('plan').disabled = value;
  $('recalculate').disabled = value;
  $('plan').textContent = value ? 'Working…' : 'Search';
  if (value) $('searchFeedback').textContent = 'Finding your route…';
}
function distance(meters) {
  const safe = Math.max(0, Number(meters) || 0);
  return safe >= 1000 ? (safe / 1000).toFixed(1) + ' km' : Math.round(safe) + ' m';
}
function minutes(seconds) {
  return Math.max(1, Math.round((Number(seconds) || 0) / 60)) + ' min';
}
function norm(text) {
  return text.trim().normalize('NFKC').toLocaleLowerCase('ro-RO').replace(/\s+/g, ' ');
}
function pointKey(point) {
  return point.map(x => Number(x).toFixed(4)).join(',');
}
function addCall(type) {
  state.calls[type]++;
  try { sessionStorage.setItem('glide.callCounts', JSON.stringify(state.calls)); } catch {}
  $('usageCounter').textContent = state.calls.search + ' searches · ' + state.calls.route + ' routes this tab';
}
function initKey() {
  try {
    const saved = sessionStorage.getItem('laneform.tomtom.key');
    if (saved) { state.key = saved; $('apiKey').value = saved; }
    const count = JSON.parse(sessionStorage.getItem('glide.callCounts') || 'null');
    state.trafficTileAttempts=trafficTileBudget(
      Number(sessionStorage.getItem('glide.trafficTileAttempts'))).used;
    const recent = JSON.parse(sessionStorage.getItem('glide.recentDestinations') || '[]');
    if (Array.isArray(recent)) state.recents = recent.filter(item =>
      typeof item?.name === 'string' && Array.isArray(item.position) &&
      item.position.length === 2 && item.position.every(Number.isFinite)
    ).slice(0, RECENT_LIMIT);
    for (const type of ['search', 'route']) {
      if (Number.isSafeInteger(count?.[type]) && count[type] >= 0) state.calls[type] = count[type];
    }
  } catch {}
  $('usageCounter').textContent = state.calls.search + ' searches · ' + state.calls.route + ' routes this tab';
  if (state.key) TomTomConfig.instance.put({ apiKey: state.key, language: 'en-GB' });
  updateTrafficBudgetLabel();
}
function saveKey() {
  const key = $('apiKey').value.trim();
  if (!key) { toast('Enter your TomTom routing key.', true); return; }
  state.key = key;
  TomTomConfig.instance.put({ apiKey: key, language: 'en-GB' });
  try { sessionStorage.setItem('laneform.tomtom.key', key); } catch {}
  $('settingsPanel').hidden = true;
  toast('Routing key saved for this browser tab.');
}
function showSettings() {
  $('settingsPanel').hidden = false;
  $('apiKey').focus();
}
function setMode(mode) {
  if (mode !== 'preview') closeRoutesTray();
  state.mode = mode;
  document.body.dataset.mode = mode;
  // The optional TomTom tile layer must never follow the animated camera.
  if(mode!=='preview'){
    $('trafficToggle').checked=false;
    updateTrafficVisibility();
  }
  $('idlePrompt').hidden = mode !== 'idle';
  $('searchSheet').hidden = mode !== 'search';
  $('previewSheet').hidden = mode !== 'preview';
  $('navHUD').hidden = mode !== 'navigation';
  $('navBar').hidden = mode !== 'navigation';
  if(mode!=='navigation')junctionDetail?.stop();
  $('settingsPanel').hidden = true;
  $('recenter').title = mode === 'navigation' ? 'Follow simulated vehicle' : 'Recenter map';
  if (mode !== 'navigation') $('laneGuidance').hidden = true;
  state.routeMarkers.forEach(marker => {
    marker.getElement().style.display = mode === 'preview' ? '' : 'none';
  });
  requestDraw();
}

// Map: user-visible cartography is supplied by OpenFreeMap / OSM, not TomTom.
// Traffic flow tiles are separate and only requested with a planned route.
function initMap() {
  const map = new MapLibreMap({
    container: 'map', style: structuredClone(mapStyle), center: DEMO_ORIGIN,
    zoom: 14.8, maxZoom: 19.5, pitch: 0, bearing: 0,
    attributionControl: true, refreshExpiredTiles: false,
    antialias: true,
    // Called for tile URLs only; map requests from OpenFreeMap are untouched.
    transformRequest(url,type){
      if(!isTomTomTrafficTile(url,type))return {url};
      if(state.trafficTileAttempts>=MAX_TRAFFIC_TILE_ATTEMPTS)
        return {url:EMPTY_TRAFFIC_TILE};
      state.trafficTileAttempts++;
      try{
        sessionStorage.setItem('glide.trafficTileAttempts',
          String(state.trafficTileAttempts));
      }catch{}
      updateTrafficBudgetLabel();
      if(state.trafficTileAttempts>=MAX_TRAFFIC_TILE_ATTEMPTS){
        $('trafficToggle').checked=false;
        if(!state.trafficBudgetTimer){
          state.trafficBudgetTimer=setTimeout(()=>{
            state.trafficBudgetTimer=null;
            updateTrafficVisibility();
            toast('Traffic tile budget reached. Overlay paused for this tab.');
          },0);
        }
      }
      return {url};
    }
  });
  state.map = map;
  map.on('style.load', () => {
    state.mapReady = true;
    $('mapState').classList.add('ready');
    $('mapState').querySelector('.map-state-label').textContent = 'Ready';
    centerInitialView();
    requestDraw();
  });
  map.on('move', requestDraw);
  map.on('zoomstart',event=>{
    // A deliberate pinch/wheel zoom takes precedence over camera following.
    if(event.originalEvent && state.mode==='navigation'){
      state.sim.follow=false;
      $('navFollow').classList.remove('selected');
      $('navFollow').setAttribute('aria-pressed','false');
    }
  });
  map.on('resize', requestDraw);
  map.on('moveend', () => {
    updateTrafficVisibility();
    requestDraw();
  });
  map.on('error', e => console.warn('Glide map tile/style issue:', e.error || e));
}
// The initial view is useful before any TomTom key is entered. Read GPS
// automatically ONLY when the browser has already granted permission; do not
// trigger a geolocation permission dialog on page load.
async function centerInitialView() {
  if (state.initialLocationChecked) return;
  state.initialLocationChecked = true;
  if (!navigator.geolocation || !navigator.permissions) return;
  const requestId = state.originRequestId;
  try {
    const permission = await navigator.permissions.query({name:'geolocation'});
    if (permission.state !== 'granted' || requestId !== state.originRequestId) return;
    navigator.geolocation.getCurrentPosition(position => {
      if (requestId !== state.originRequestId) return;
      const point=[position.coords.longitude,position.coords.latitude];
      if (!point.every(Number.isFinite)) return;
      state.gps=point; state.gpsAt=Date.now();
      state.originMode='gps';
      showCurrentPosition(point);
      updateOriginLabel();
      if (state.mode === 'idle' || state.mode === 'search')
        state.map.easeTo({center:point,zoom:15.5,pitch:0,bearing:0,
          padding:{top:0,bottom:0,left:0,right:0},duration:MOTION});
    }, error => {
      // No prompt, no interruption, no retry loop: fall back to Răzoare.
      console.info('Glide startup GPS unavailable:',error.message);
    },{enableHighAccuracy:false,maximumAge:60000,timeout:6500});
  } catch (error) {
    console.info('Glide location permission cannot be queried:',error);
  }
}
function mapMarkerElement(className,label){
  const element=document.createElement('div');
  element.className=className;
  element.setAttribute('role','img');
  element.setAttribute('aria-label',label);
  return element;
}
function showCurrentPosition(point) {
  if (!state.map) return;
  if (state.gpsMarker) state.gpsMarker.setLngLat(point);
  else state.gpsMarker=new Marker({
    element:mapMarkerElement('current-position-dot','Current approximate position'),
    anchor:'center'
  }).setLngLat(point).addTo(state.map);
}
function routeSegments(feature) {
  const geometry = feature?.geometry;
  if (geometry?.type === 'LineString' && geometry.coordinates?.length >= 2)
    return [geometry.coordinates];
  if (geometry?.type === 'MultiLineString' && Array.isArray(geometry.coordinates))
    return geometry.coordinates.filter(x => x.length >= 2);
  return [];
}
function selectedRoute() { return state.routes?.features?.[state.selected]; }
function tomtomLaneRecords(route) {
  if (!route) return [];
  if (!state.laneCache.has(route))
    state.laneCache.set(route, extractRouteLaneGuidance(route, getInstructionLanes));
  return state.laneCache.get(route);
}
function osmLaneRecords(route) {
  if (!route || !state.osmWays.length) return [];
  if (!state.osmCache.has(route))
    state.osmCache.set(route, deriveOsmLaneRecords(route,state.osmWays));
  return state.osmCache.get(route);
}
function corridorLaneRecords(route) {
  if(!route||!state.osmWays.length)return [];
  if(!state.corridorCache.has(route))
    state.corridorCache.set(route,laneEventsFromCorridor(route,state.osmWays));
  return state.corridorCache.get(route);
}
function laneRecords(route) {
  if(!route)return [];
  if(!state.timelineCache.has(route))
    state.timelineCache.set(route,buildLaneTimeline(
      route,tomtomLaneRecords(route),osmLaneRecords(route),corridorLaneRecords(route)
    ));
  return state.timelineCache.get(route);
}
function updateLaneCoverage() {
  const route=selectedRoute();
  const raw=route?.properties?.sections?.lanes?.length || 0;
  const total=route?.properties?.guidance?.instructions?.length || 0;
  const tomtom=tomtomLaneRecords(route).length;
  const mapped=state.osmStatus==='ready'
    ? laneRecords(route).filter(x=>x.guidance.source==='osm').length : null;
  const status=state.osmStatus;
  const scan=state.osmCoverageMeters
    ? ' · first '+distance(state.osmCoverageMeters) : '';
  let osmText;
  if(status==='ready') {
    osmText='OSM: '+state.osmRawWays+' tagged roads retrieved; '+
      mapped+' route-matched lane events'+scan+
      ' · '+state.osmProvider+'. Only part of the route was checked.';
  } else if(status==='checking'){
    osmText='OSM: checking mapped lane markings…';
  } else if(status==='unavailable'){
    osmText='OSM: NOT CHECKED — '+(state.osmFailure || 'source unreachable')+
      ' ('+(state.osmFailureKind||'service failure')+').';
  } else if(status==='too-large'){
    osmText='OSM: NOT CHECKED — query exceeded safe data limits.';
  } else if(status==='rate-limited'){
    osmText='OSM: NOT CHECKED — request cooldown'+
      (state.osmRetryAfter?' ('+state.osmRetryAfter+'s remaining)':'')+'.';
  } else if(status==='no-geometry'){
    osmText='OSM: NOT CHECKED — missing route geometry.';
  } else osmText='OSM: not yet checked.';
  $('laneCoverage').textContent=route
    ? 'TomTom: '+tomtom+' lane-guided maneuvers / '+total+
      ' instructions ('+raw+' raw lane sections). '+
      'Additional junction geometry is prepared individually during route simulation. '+
      'Reconstructed geometry is unverified, not lane-to-lane navigation.'
    : 'Lane sources appear after route planning.';
  const preview=$('previewLaneStatus');
  if(preview){
    const tt=tomtom ? tomtom+' TomTom' : 'No TomTom lane guidance';
    preview.textContent=!route?''
      : status==='ready'
        ? 'Lane lookahead · '+tt+' · '+mapped+' OSM mapped'
        : status==='checking'?'Lane lookahead · '+tt+' · checking OSM…'
        : status==='unavailable'?'Lane lookahead · '+tt+' · OSM unavailable'
        : status==='rate-limited'?'Lane lookahead · '+tt+' · OSM deferred'
        : status==='too-large'?'Lane lookahead · '+tt+' · OSM scan too large'
        : 'Lane lookahead · '+tt+' · junction geometry prepares during simulation';
    preview.title=route
      ? 'Only completed OSM scans have a meaningful match count. '+
        'Mapped turn arrows are not verified lane connections.'
      : '';
  }
}
function clearCanvas() {
  const canvas = $('routeOverlay');
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}
function requestDraw() {
  if (state.drawQueued) return;
  state.drawQueued = true;
  requestAnimationFrame(() => {
    state.drawQueued = false;
    drawRoutes();
  });
}
function drawRoutes() {
  const map = state.map, canvas = $('routeOverlay');
  if (!map || !state.mapReady || !canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = map.getContainer().clientWidth, height = map.getContainer().clientHeight;
  if (!width || !height) return;
  const w = Math.round(width * dpr), h = Math.round(height * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!state.routes || (state.mode !== 'preview' && state.mode !== 'navigation')) return;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // Segments can be the original provider geometry, or the locally split
  // traveled/untraveled polyline during simulation.
  const stroke = (segments, color, strokeWidth, opacity, blur = 0) => {
    ctx.save();
    ctx.lineWidth = strokeWidth; ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    if (blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
    for (const segment of segments) {
      if (!segment || segment.length < 2) continue;
      ctx.beginPath();
      let first = true;
      for (const c of segment) {
        if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
        const p = map.project(c);
        if (first) { ctx.moveTo(p.x, p.y); first = false; }
        else ctx.lineTo(p.x, p.y);
      }
      if (!first) ctx.stroke();
    }
    ctx.restore();
  };
  // Other routes are only useful during selection, not active walkthrough.
  if (state.mode === 'preview') {
    state.routes.features.forEach((route, i) => {
      if (i !== state.selected) stroke(routeSegments(route), '#66747E', 2.4, .36);
    });
  }

  const feature = selectedRoute();
  if (!feature) return;
  const sim = state.sim;
  if (state.mode === 'navigation' && sim.active && sim.points.length >= 2) {
    const { traveled, remaining } = splitPathByDistance(
      sim.points, sim.cumulative, sim.distance
    );
    // The traveled section is a matte graphite line. No halo, shadow,
    // platinum core or extra trail; only the road ahead is illuminated.
    const junctionFocus=junctionDetail?.active()===true;
    if (traveled.length >= 2)
      stroke([traveled], '#73818B', junctionFocus?2.6:3.4, junctionFocus?.46:.63);
    if (remaining.length >= 2) {
      // Junction-scale geometry is now legible. Keep the road-level route
      // as a narrow silver trace; do NOT snap it to an inferred lane.
      if(junctionFocus){
        // Where tagged, route-aligned candidate lane traces exist, reduce the
        // ROAD-level centerline to context. They never connect across the
        // intersection without validated lane-to-lane connectivity.
        const candidates=junctionDetail?.candidateCount()||0;
        stroke([remaining],ROUTE_HALO,candidates?2.3:4.4,
          candidates?.055:.09,2);
        stroke([remaining],SIGNAL,candidates?1.55:3.1,
          candidates?.40:.93);
      }else{
        stroke([remaining], ROUTE_HALO, 7.5, .14, 5);
        stroke([remaining], SIGNAL, 5.2, .99);
      }
    }
    return;
  }

  stroke(routeSegments(feature), ROUTE_HALO, 7.5, .14, 5);
  stroke(routeSegments(feature), SIGNAL, 4.7, .99);
}
function fitRoute() {
  if (!state.map || !selectedRoute()) return;
  const bounds = new LngLatBounds();
  for (const segment of routeSegments(selectedRoute())) {
    for (const p of segment) {
      if (Number.isFinite(p[0]) && Number.isFinite(p[1])) bounds.extend(p);
    }
  }
  if (bounds.isEmpty()) return;
  const mobile = window.innerWidth <= 760;
  // Leave breathing room for the floating journey pod, not an imagined
  // full-height website sidebar. The tray only appears when requested.
  const bottom = mobile ? Math.min(300, Math.round(innerHeight * .37)) : 245;
  state.map.fitBounds(bounds, {
    padding: { top: 82, bottom, left: mobile ? 28 : 85, right: mobile ? 28 : 85 },
    maxZoom: 15, duration: MOTION
  });
}
function overview() {
  if (!state.map) return;
  const map=state.map;
  if (map.getPitch()>1 || Math.abs(map.getBearing())>1) {
    map.once('moveend',fitRoute);
    map.easeTo({pitch:0,bearing:0,padding:{top:0,bottom:0,left:0,right:0},duration:MOTION});
  } else {
    fitRoute();
  }
}
function refreshMarkers() {
  state.routeMarkers.forEach(x => x.remove());
  state.routeMarkers = [];
  if (!state.routes) return;
  const start = origin();
  if (start) state.routeMarkers.push(new Marker({
    element:mapMarkerElement('route-origin-dot','Route starting point'),
    anchor:'center'
  }).setLngLat(start).addTo(state.map));
  if (state.destination) state.routeMarkers.push(new Marker({
    element:mapMarkerElement('destination-donut','Destination'),
    anchor:'center'
  }).setLngLat(state.destination).addTo(state.map));
  if (state.mode !== 'preview') state.routeMarkers.forEach(marker => {
    marker.getElement().style.display = 'none';
  });
}
function trafficUrl(){
  return 'https://api.tomtom.com/traffic/map/4/tile/flow/relative-delay/{z}/{x}/{y}.pbf?key='
    + encodeURIComponent(state.key);
}
function updateTrafficBudgetLabel(){
  const node=$('trafficBudgetStatus');
  if(!node)return;
  const budget=trafficTileBudget(state.trafficTileAttempts);
  node.textContent='TomTom traffic tile attempts this tab: '+budget.used+'/'+
    MAX_TRAFFIC_TILE_ATTEMPTS+'. '+(budget.exhausted
      ? 'Limit reached; overlay disabled until a new browser tab.'
      : 'Optional preview only; off during simulation. Not official billing data.');
}
function removeTrafficSource(){
  const map=state.map;
  if(!map)return;
  const layerId='glide-traffic-delays',sourceId='glide-traffic';
  try{
    if(map.getLayer(layerId))map.removeLayer(layerId);
    if(map.getSource(sourceId))map.removeSource(sourceId);
  }catch(error){
    console.warn('Traffic overlay removal deferred:',error);
  }
  state.trafficAvailable=false;
}
function updateTrafficVisibility(){
  const map=state.map;
  if(!map||!state.mapReady)return;
  const exhausted=trafficTileBudget(state.trafficTileAttempts).exhausted;
  const active=state.mode==='preview' && $('trafficToggle').checked &&
    !!state.routes && !!state.key && !exhausted &&
    map.getZoom()>=12 && map.getZoom()<=15;
  const sourceId='glide-traffic',layerId='glide-traffic-delays';
  if(!active){
    // Hiding a MapLibre layer alone can leave a remote tile source alive.
    // Completely remove it when not explicitly previewing congestion.
    removeTrafficSource();
    updateTrafficBudgetLabel();
    return;
  }
  if(map.getSource(sourceId))return;
  try{
    map.addSource(sourceId,{
      type:'vector',tiles:[trafficUrl()],minzoom:12,maxzoom:15,
      attribution:'© TomTom Traffic'
    });
    map.addLayer({
      id:layerId,source:sourceId,'source-layer':'Traffic flow',type:'line',
      filter:['any',
        ['==',['get','road_closure'],true],
        ['all',['has','traffic_level'],
          ['<',['to-number',['get','traffic_level'],1],.50]]
      ],
      layout:{'line-cap':'round','line-join':'round'},
      paint:{
        'line-color':['case',
          ['==',['get','road_closure'],true],'#8D4747',
          ['<',['to-number',['get','traffic_level'],1],.28],'#8D4747',
          '#A87A45'],
        'line-width':['interpolate',['linear'],['zoom'],12,2.1,15,3.5],
        'line-opacity':.70
      }
    });
    state.trafficAvailable=true;
    state.lastTrafficAt=Date.now();
  }catch(error){console.warn('Optional traffic overlay unavailable:',error);}
}
function origin() { return state.originMode === 'gps' ? state.gps : DEMO_ORIGIN; }
function updateOriginLabel() {
  $('originDescription').textContent = state.originMode === 'gps' && state.gps ?
    'From my location' : 'From Răzoare · demo';
}
function setOrigin(mode) {
  $('originOptions').hidden = true;
  $('originChange').setAttribute('aria-expanded','false');
  if (mode === 'demo') {
    state.originRequestId++;
    state.originMode = 'demo';
    updateOriginLabel();
    return;
  }
  if (!navigator.geolocation) {
    toast('Location is unavailable on this device.', true);
    setOrigin('demo');
    return;
  }
  if (state.gps && Date.now() - state.gpsAt < 300000) {
    state.originMode = 'gps';
    updateOriginLabel();
    return;
  }
  state.originMode = 'gps';
  state.gps = null; // never route with stale location while acquiring a fresh fix
  const requestId = ++state.originRequestId;
  $('originDescription').textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(position => {
    if (requestId !== state.originRequestId || state.originMode !== 'gps') return;
    state.gps = [position.coords.longitude, position.coords.latitude];
    state.gpsAt = Date.now();
    showCurrentPosition(state.gps);
    updateOriginLabel();
    if (state.mode==='search' || state.mode==='idle')
      state.map.easeTo({center:state.gps,zoom:15.5,pitch:0,bearing:0,
        duration:MOTION});
  }, error => {
    if (requestId !== state.originRequestId || state.originMode !== 'gps') return;
    state.originMode = 'demo';
    updateOriginLabel();
    toast('Location unavailable. Răzoare demo is selected.', true);
    console.info('Location error:', error.message);
  }, {enableHighAccuracy:true, maximumAge:5000, timeout:11000});
}
async function tryUseGrantedLocation() {
  // Ask the browser only when the user opens destination search.
  // Existing permission is reused silently; new permission is requested only
  // after the user explicitly selects 'Use my location'.
  if (!navigator.permissions || state.originMode === 'gps') return;
  try {
    const permission = await navigator.permissions.query({name:'geolocation'});
    if (permission.state === 'granted' && state.mode === 'search') setOrigin('gps');
  } catch { /* API not supported */ }
}
function openSearch() {
  updateSearchViewport();
  setMode('search');
  $('searchFeedback').textContent = '';
  $('searchResults').replaceChildren();
  $('originOptions').hidden = true;
  $('originChange').setAttribute('aria-expanded','false');
  updateOriginLabel();
  renderRecents();
  tryUseGrantedLocation();
  requestAnimationFrame(() => $('destination').focus({preventScroll:true}));
}
function backToIdle() {
  setMode('idle');
  $('destination').blur();
  if (state.map) state.map.easeTo({
    center:state.gps || DEMO_ORIGIN,zoom:state.gps?15.5:14.8,
    pitch:0,bearing:0,padding:{top:0,bottom:0,left:0,right:0},duration:MOTION
  });
}
// Search stays centered. The chosen destination becomes a journey bubble
// that gracefully descends to the lower preview position.
function revealPreviewFromSearch(sourceRect) {
  if (!sourceRect || isReducedMotion || typeof $('previewSheet').animate !== 'function') return;
  const preview = $('previewSheet');
  const targetRect = preview.getBoundingClientRect();
  const dx = sourceRect.left + sourceRect.width / 2 -
    (targetRect.left + targetRect.width / 2);
  const dy = sourceRect.top + sourceRect.height / 2 -
    (targetRect.top + targetRect.height / 2);
  const base = window.innerWidth <= 760 ? '' : 'translateX(-50%) ';
  preview.animate([
    {opacity:0.28, transform:base+`translate(${dx}px,${dy}px) scale(.91)`},
    {opacity:1, transform:base+'translate(0px,0px) scale(1)'}
  ], {duration:850, easing:'cubic-bezier(.19,1,.22,1)'});
}
// Keep the search bubble centered in the *visible* viewport when a phone
// keyboard changes the available height, rather than hiding the field below.
function updateSearchViewport() {
  const v = window.visualViewport;
  if (v) {
    document.documentElement.style.setProperty('--search-center-y',
      (v.offsetTop + v.height / 2) + 'px');
    document.documentElement.style.setProperty('--search-available-height',
      v.height + 'px');
  }
}
function renderItemList(container,items) {
  container.replaceChildren();
  for (const item of items) {
    if (!Array.isArray(item.position) || !item.position.every(Number.isFinite)) continue;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'search-result';
    const marker = document.createElement('span');
    marker.className = 'result-pin'; marker.setAttribute('aria-hidden','true');
    const ring = document.createElement('span');
    ring.className = 'result-donut';
    marker.append(ring);
    const copy = document.createElement('span');
    copy.className = 'result-copy';
    const name = document.createElement('strong');
    name.textContent = item.name;
    const address = document.createElement('small');
    address.textContent = item.address || 'Bucharest';
    copy.append(name,address);
    row.append(marker,copy);
    row.addEventListener('click', () => chooseDestination(item));
    container.append(row);
  }
}
function renderRecents() {
  const query = norm($('destination').value);
  const list = query ?
    state.recents.filter(item => norm(item.name).includes(query) ||
      norm(item.address || '').includes(query)) : state.recents;
  $('recentSection').hidden = list.length === 0;
  renderItemList($('recentList'),list);
}
function rememberDestination(item) {
  state.recents = [item, ...state.recents.filter(x =>
    pointKey(x.position) !== pointKey(item.position))].slice(0,RECENT_LIMIT);
  try { sessionStorage.setItem('glide.recentDestinations',JSON.stringify(state.recents)); }
  catch { /* session storage disabled */ }
}
async function searchDestinations() {
  if (state.busy) return;
  const query = $('destination').value.trim();
  if (query.length < 3) {
    $('searchFeedback').textContent = 'Enter at least three characters.';
    return;
  }
  if (!state.key) {
    showSettings();
    toast('Add a TomTom routing key to search places.',true);
    return;
  }
  const cached = state.searchCache.get(norm(query));
  if (cached && Date.now()-cached.at < SEARCH_TTL) {
    showSearchMatches(cached.items);
    return;
  }
  if (Date.now()-state.lastSearchAt < SEARCH_GAP) {
    $('searchFeedback').textContent = 'Please wait a moment before searching again.';
    return;
  }
  state.lastSearchAt = Date.now();
  state.busy = true;
  $('plan').disabled = true;
  $('plan').textContent = 'Searching…';
  $('searchFeedback').textContent = '';
  $('searchResults').replaceChildren();
  $('recentSection').hidden = true;
  try {
    const text = query; // Worldwide search: never append a fixed city.
    addCall('search');
    const mapCenter=state.map?.getCenter?.();
    const nearby=state.gps ||
      (mapCenter ? [mapCenter.lng,mapCenter.lat] : BUCHAREST);
    const results = await discoverPlaces({
      query:text,geoBias:{position:nearby},limit:5
    });
    const items = (results?.features||[]).map(feature => ({
      name:feature.properties?.poi?.name ||
        feature.properties?.address?.freeformAddress || query,
      address:feature.properties?.address?.freeformAddress || '',
      position:feature.geometry?.coordinates
    })).filter(item => Array.isArray(item.position) && item.position.length === 2 &&
      item.position.every(Number.isFinite));
    state.searchCache.set(norm(query),{items,at:Date.now()});
    if (state.mode === 'search' && norm($('destination').value) === norm(query))
      showSearchMatches(items);
  } catch (error) {
    console.error('Glide destination search:',error);
    $('searchFeedback').textContent = 'Search failed. Check your key or connection and try again.';
    renderRecents();
  } finally {
    state.busy = false;
    $('plan').disabled = false;
    $('plan').textContent = 'Search';
  }
}
function showSearchMatches(items) {
  $('recentSection').hidden = true;
  $('searchFeedback').textContent = items.length ? 'Select a destination' : 'No results. Try a fuller address.';
  renderItemList($('searchResults'),items);
}
function chooseDestination(item) {
  if (state.busy) return;
  $('destination').value = item.name;
  planRoute(false,item);
}
// Routing is called only after an explicit destination selection or manual
// traffic refresh; opening search and typing do not consume TomTom requests.
async function planRoute(force = false, chosenPlace = null) {
  if (state.busy) return;
  if (!state.mapReady) { toast('The map is still preparing. Please try again.',true); return; }
  if (!state.key) { showSettings(); toast('Add a TomTom key to calculate routes.',true); return; }
  const start = origin();
  if (!start) { toast('Location is not available yet. Choose an origin.',true); return; }
  const destination = force ? state.destination : chosenPlace?.position;
  if (!destination || !destination.every(Number.isFinite)) {
    toast('Select a destination from the search results.',true); return;
  }
  const signature = pointKey(start)+'|'+pointKey(destination);
  const now = Date.now();
  if (state.routes && signature === state.routeSignature && now-state.routeAt < ROUTE_TTL) {
    if (force) toast('Traffic was updated recently. Try again shortly.');
    else {
      const searchRect = state.mode === 'search' ?
        $('searchSheet').getBoundingClientRect() : null;
      refreshMarkers();setMode('preview');renderPreview();overview();
      revealPreviewFromSearch(searchRect);
      toast('Using your recent route.');
    }
    return;
  }
  if (now - state.attemptAt < REQUEST_GAP) {
    toast('Please wait '+Math.ceil((REQUEST_GAP-(now-state.attemptAt))/1000)+
      ' seconds before recalculating.');
    return;
  }
  state.attemptAt = now;
  state.destination = destination;
  state.destinationName = force ?
    state.destinationName : (chosenPlace.name || $('destination').value.trim());
  uiBusy(true);
  try {
    addCall('route');
    const result = await calculateRoute({
      locations:[start,destination],travelMode:'car',maxAlternatives:2,
      guidance:{type:'coded'},costModel:{routeType:'fast',traffic:'live'}
    });
    if (!result?.features?.length || !routeSegments(result.features[0]).length)
      throw new Error('No usable road route was returned.');
    state.routes=result;
    state.laneCache=new WeakMap();
    state.osmCache=new WeakMap();
    state.corridorCache=new WeakMap();state.timelineCache=new WeakMap();
    state.routeSignature=signature;
    state.routeAt=Date.now();
    state.selected=0;
    $('searchFeedback').textContent = '';
    if (!force) rememberDestination({
      name:state.destinationName,address:chosenPlace.address || '',
      position:destination
    });
    const searchRect = state.mode === 'search' ?
      $('searchSheet').getBoundingClientRect() : null;
    refreshMarkers();
    setMode('preview');
    renderPreview();
    overview();
    revealPreviewFromSearch(searchRect);
    updateTrafficVisibility();
    // Public Overpass cannot support background lane requests at scale.
    // The simulation now prepares only the next junction geometry on demand.
    state.osmStatus='not-checked';
    state.osmWays=[];state.osmRawWays=0;state.osmProvider='';
    state.osmCoverageMeters=0;
    updateLaneCoverage();
  } catch (error) {
    console.error('Glide routing:',error);
    toast('Route unavailable: '+(error.message||'check routing access'),true);
    $('searchFeedback').textContent = 'Unable to calculate this route. You can choose another place.';
    if (state.mode === 'preview' && force) {
      // Keep the last usable route visible even if a manual refresh fails.
      requestDraw();
    }
  } finally {
    uiBusy(false);
  }
}
function renderPreview() {
  const route=selectedRoute();
  if (!route) return;
  const summary=route.properties?.summary || {};
  $('previewDestination').textContent=state.destinationName || 'Destination';
  updateLaneCoverage();
  $('summaryTime').textContent=minutes(summary.travelTimeInSeconds);
  $('summaryLength').textContent=distance(summary.lengthInMeters);
  const delay=summary.trafficDelayInSeconds || 0;
  $('summaryDelay').textContent=delay>40?minutes(delay)+' delay':'Traffic-aware';
  const target=$('routeChoices');
  target.replaceChildren();
  const alternatives = Math.max(0, state.routes.features.length - 1);
  $('routeAlternativeCount').textContent = alternatives ? String(alternatives) : '';
  $('routesToggle').hidden = alternatives === 0;
  if (!alternatives) closeRoutesTray();
  state.routes.features.forEach((r,index)=>{
    const button=document.createElement('button');
    button.type='button';
    button.className='route-option'+(index===state.selected?' selected':'');
    const label=document.createElement('span');
    label.textContent=index===0?'Recommended':'Alternative '+index;
    const duration=document.createElement('strong');
    duration.textContent=minutes(r.properties?.summary?.travelTimeInSeconds);
    button.append(label,duration);
    button.addEventListener('click',()=>{
      state.selected=index;
      renderPreview();
      closeRoutesTray();
      requestDraw();
      overview();
    });
    target.append(button);
  });
  requestDraw();
}

// Simulated progression uses a locally interpolated polyline: zero extra
// Routing/Search requests while playing or scrubbing.
function metersBetween(a,b){
  const R=6371000,rad=Math.PI/180;
  const latDelta=(b[1]-a[1])*rad,lonDelta=(b[0]-a[0])*rad;
  const q=Math.sin(latDelta/2)**2+
    Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(lonDelta/2)**2;
  return 2*R*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
}
function buildPath(feature){
  const points=[];
  for(const segment of routeSegments(feature)){
    for(const c of segment){
      if(!Number.isFinite(c?.[0])||!Number.isFinite(c?.[1]))continue;
      if(!points.length||metersBetween(points[points.length-1],c)>.1)points.push(c);
    }
  }
  const cumulative=[0];
  for(let i=1;i<points.length;i++)cumulative.push(cumulative[i-1]+metersBetween(points[i-1],points[i]));
  return {points,cumulative,length:cumulative[cumulative.length-1]||0};
}
function along(meters){
  const w=state.sim;
  if(w.points.length<2)return null;
  const d=Math.max(0,Math.min(w.length,meters));
  let lo=1,hi=w.cumulative.length-1;
  while(lo<hi){const m=(lo+hi)>>1;if(w.cumulative[m]<d)lo=m+1;else hi=m;}
  const a=w.points[lo-1],b=w.points[lo];
  const delta=Math.max(.001,w.cumulative[lo]-w.cumulative[lo-1]);
  const f=Math.max(0,Math.min(1,(d-w.cumulative[lo-1])/delta));
  const point=[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];
  const angle=Math.atan2((b[0]-a[0])*Math.cos(point[1]*Math.PI/180),b[1]-a[1])*180/Math.PI;
  return {point,angle};
}
function turnArrow(instruction){
  const m=String(instruction?.maneuver||instruction?.message||'').toLowerCase();
  if(m.includes('left'))return '↰';
  if(m.includes('right'))return '↱';
  if(m.includes('roundabout'))return '⟳';
  if(m.includes('uturn')||m.includes('u-turn'))return '⤺';
  return '↑';
}
function turnLabel(instruction){
  if(instruction?.message)return instruction.message;
  const road=instruction?.street || instruction?.nextRoadInfo?.streetName?.text;
  const maneuver=String(instruction?.maneuver || '').toUpperCase();
  let action='Continue';
  if(maneuver.includes('LEFT'))action='Turn left';
  else if(maneuver.includes('RIGHT'))action='Turn right';
  else if(maneuver.includes('ROUNDABOUT'))action='Use the roundabout';
  return road ? action+' onto '+road : action+' along the route';
}
function renderLaneAssistance(laneData){
  const panel=$('laneGuidance');
  // Missing/unreliable provider data? Show ordinary turn guidance instead.
  panel.replaceChildren();
  panel.hidden=true;
  if(!['tomtom','osm'].includes(laneData?.source) || !Array.isArray(laneData.lanes))return;
  const info=document.createElement('span');
  info.className='lane-source';
  const lead=laneData.distanceToManeuver?
    distance(laneData.distanceToManeuver)+' ahead':'Approaching';
  info.textContent=laneData.source==='osm'
    ? (laneData.kind==='continuity' && laneData.movement==='STRAIGHT'
      ? 'Straight-arrow lanes · ' : 'Mapped turn arrows · ')+
        lead+' · OSM (unverified)'
    : 'Suggested lanes · '+lead+' · TomTom';
  const rail=document.createElement('div');
  rail.className='lane-rail';
  rail.setAttribute('aria-label','Recommended lane directions, left to right');
  for(const lane of laneData.lanes){
    const cell=document.createElement('div');
    cell.className='lane-cell'+(lane.recommended?' recommended':'')+
      (laneData.source==='osm'?' osm-markings':'');
    cell.setAttribute('aria-label',lane.recommended
      ? (laneData.source==='osm'?'Mapped arrow matching turn: ':'Suggested lane: ')+
        lane.follow.replaceAll('_',' ').toLowerCase()
      : 'Other marked lane');
    // A single emphasized route-follow arrow; multiple allowed directions
    // are not claimed as recommendations.
    const direction=lane.follow || lane.directions[0];
    const symbol=document.createElement('span');
    symbol.setAttribute('aria-hidden','true');
    symbol.className='lane-arrow';
    symbol.textContent=LANE_ARROWS[direction] || '↑';
    cell.append(symbol);
    rail.append(cell);
  }
  panel.append(info,rail);
  panel.hidden=false;
}
function navCamera(p,immediate=false){
  if(!state.sim.follow||!state.map||!p)return;
  const now=performance.now();
  if(!immediate && now-state.sim.lastCamera<720)return;
  state.sim.lastCamera=now;
  const h=window.innerHeight;
  const detail=junctionDetail?.active() && junctionDetail.position();
  const padding=detail
    ? {top:Math.round(h*.25),bottom:Math.round(h*.18),left:0,right:0}
    : {top:Math.round(h*.40),bottom:Math.round(h*.12),left:0,right:0};
  state.map.easeTo({
    center:detail||p.point,bearing:p.angle,
    pitch:detail?38:59,zoom:detail?18.25:15.65,
    padding,duration:immediate?MOTION:(isReducedMotion ? 0 : 980)
  });
}
function navHud(){
  const sim=state.sim,route=selectedRoute();
  if(!sim.active||!route)return;
  const summary=route.properties?.summary||{};
  const fraction=sim.length?sim.distance/sim.length:0;
  const realLength=summary.lengthInMeters||sim.length;
  const offset=fraction*realLength;
  const instructions=route.properties?.guidance?.instructions||[];
  const nextState=nextManeuverState(instructions,offset,realLength);
  const next=nextState.type==='turn' ? nextState.instruction : null;
  $('navDistance').textContent=distance(nextState.distance);
  $('navInstruction').textContent=nextState.type==='turn' ? turnLabel(next)
    : nextState.type==='approach' ? arrivalApproachText(nextState.instruction)
    : nextState.type==='complete' ? 'Destination reached'
    : 'Continue toward destination';
  $('navArrow').textContent=nextState.type==='turn' ? turnArrow(next)
    : nextState.type==='complete' ? '✓'
    : nextState.type==='approach' ? '◎' : '↑';
  $('navRemaining').textContent=distance(Math.max(0,realLength-offset));
  const timeLeft=(summary.travelTimeInSeconds||0)*(1-fraction);
  $('navTime').textContent=timeLeft>1?minutes(timeLeft):'0 min';
  const expectedArrival=new Date(Date.now()+timeLeft*1000);
  $('navETA').textContent=expectedArrival.toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'});
  $('navScrub').value=String(Math.round(fraction*1000));
  // Anticipate mapped lane changes even when the route continues straight
  // and TomTom did not generate a maneuver at that intersection.
  const laneData=chooseLaneLookahead(laneRecords(route),offset,{
    horizonMeters:1100,minimumMeters:14,
    nextManeuver:nextState,instructions
  });
  renderLaneAssistance(laneData);
  junctionDetail?.update(offset);
}
function positionSim(meters,forceCamera=false){
  const sim=state.sim;
  if(!sim.active)return;
  sim.distance=Math.max(0,Math.min(sim.length,meters));
  const p=along(sim.distance);
  if(!p)return;
  sim.marker?.setLngLat(p.point).setRotation(p.angle);
  navHud();
  if(sim.follow)navCamera(p,forceCamera);
  requestDraw(); // update the muted traveled route even when camera following is off
  if(sim.distance>=sim.length)pauseSim();
}
function startNavigationDemo(){
  if(!selectedRoute())return;
  const path=buildPath(selectedRoute());
  if(path.points.length<2||!path.length){toast('This route has no usable geometry.',true);return;}
  pauseSim();
  const sim=state.sim;
  Object.assign(sim,path,{active:true,playing:false,distance:0,follow:true,lastCamera:0,lastFrame:0});
  const icon=document.createElement('div');
  icon.className='gliding-marker';
  sim.marker?.remove();
  sim.marker=new Marker({element:icon,rotationAlignment:'map'}).setLngLat(path.points[0]).addTo(state.map);
  state.routeMarkers.forEach(marker=>marker.getElement().style.display='none');
  setMode('navigation');
  junctionDetail?.begin(selectedRoute());
  $('navPlay').textContent='Play';
  $('navFollow').classList.add('selected');
  $('navFollow').setAttribute('aria-pressed','true');
  $('navScrub').value='0';
  navHud();
  navCamera(along(0),true);
  toast('Simulation only · Not active GPS navigation.');
}
function pauseSim(){
  const sim=state.sim;
  sim.playing=false;
  if(sim.raf!==null)cancelAnimationFrame(sim.raf);
  sim.raf=null;
  sim.lastFrame=0;
  $('navPlay').textContent=sim.distance>=sim.length?'Replay':'Play';
}
function tickSim(timestamp){
  const sim=state.sim;
  if(!sim.playing||!sim.active)return;
  if(sim.lastFrame){
    const dt=Math.max(0,Math.min(.10,(timestamp-sim.lastFrame)/1000));
    // 7× a nominal 45 km/h. Not representative of actual speed/traffic.
    positionSim(sim.distance+dt*(45/3.6)*7);
  }
  sim.lastFrame=timestamp;
  if(sim.playing)sim.raf=requestAnimationFrame(tickSim);
}
function toggleSim(){
  const sim=state.sim;
  if(!sim.active)return;
  if(sim.playing){pauseSim();return;}
  if(sim.distance>=sim.length)positionSim(0,true);
  sim.playing=true;sim.lastFrame=0;$('navPlay').textContent='Pause';
  sim.raf=requestAnimationFrame(tickSim);
}
function stopNavigationDemo(){
  pauseSim();
  state.sim.marker?.remove();
  state.sim.marker=null;
  state.sim.active=false;
  junctionDetail?.stop();
  state.routeMarkers.forEach(marker=>marker.getElement().style.display='');
  setMode('preview');
  overview();
}


// Other routes are context, not an always-visible stack of dashboard rows.
function closeRoutesTray() {
  const tray = $('routesTray');
  const toggle = $('routesToggle');
  if (tray) tray.hidden = true;
  if (toggle) toggle.setAttribute('aria-expanded','false');
}
function toggleRoutesTray() {
  if (state.mode !== 'preview' || $('routesToggle').hidden) return;
  const expanded = $('routesToggle').getAttribute('aria-expanded') === 'true';
  $('routesTray').hidden = expanded;
  $('routesToggle').setAttribute('aria-expanded',String(!expanded));
}
function attachEvents() {
  updateSearchViewport();
  window.visualViewport?.addEventListener('resize',updateSearchViewport);
  window.visualViewport?.addEventListener('scroll',updateSearchViewport);
  window.addEventListener('resize',updateSearchViewport);
  $('idlePrompt').addEventListener('click',openSearch);
  $('searchBack').addEventListener('click',backToIdle);
  $('searchDismiss').addEventListener('click',backToIdle);
  $('routeForm').addEventListener('submit',event=>{
    event.preventDefault();
    searchDestinations();
  });
  $('destination').addEventListener('input',()=>{
    $('searchResults').replaceChildren();
    $('searchFeedback').textContent='';
    renderRecents(); // Local filtering only; does not call an API.
  });
  $('originChange').addEventListener('click',()=>{
    $('originOptions').hidden=!$('originOptions').hidden;
    $('originChange').setAttribute('aria-expanded',String(!$('originOptions').hidden));
  });
  $('demoOrigin').addEventListener('click',()=>setOrigin('demo'));
  $('gpsOrigin').addEventListener('click',()=>setOrigin('gps'));
  $('settingsOpen').addEventListener('click',()=>{
    $('settingsPanel').hidden?showSettings():$('settingsPanel').hidden=true;
  });
  $('settingsClose').addEventListener('click',()=>{$('settingsPanel').hidden=true;});
  $('saveKey').addEventListener('click',saveKey);
  $('apiKey').addEventListener('keydown',event=>{if(event.key==='Enter')saveKey();});
  $('trafficToggle').addEventListener('change',()=>{
    if($('trafficToggle').checked &&
      trafficTileBudget(state.trafficTileAttempts).exhausted){
      $('trafficToggle').checked=false;
      toast('Traffic tile preview has reached its per-tab request limit.');
    }else if($('trafficToggle').checked && state.mode!=='preview'){
      $('trafficToggle').checked=false;
      toast('Traffic tiles are available only while previewing a planned route.');
    }else if($('trafficToggle').checked &&
      (state.map?.getZoom?.()||0)>15){
      toast('Zoom out slightly to see major traffic delays.');
    }
    updateTrafficVisibility();
  });
  junctionDetail=createJunctionDetail({
    mapGetter:()=>state.map,
    buttonGetter:()=>$('junctionToggle'),
    onViewChange:()=>{
      if(state.sim.active && state.sim.follow)
        navCamera(along(state.sim.distance),true);
    },
    onButtonAction:()=>{
      if(!state.sim.active)return;
      state.sim.follow=true;
      $('navFollow').classList.add('selected');
      $('navFollow').setAttribute('aria-pressed','true');
      navCamera(along(state.sim.distance),true);
    }
  });
  $('backToPlanning').addEventListener('click',()=>{
    // Keep the calculated route in memory, but hide it during a new search.
    state.routeMarkers.forEach(x=>x.getElement().style.display='none');
    openSearch();
    state.map.easeTo({
      pitch:0,bearing:0,padding:{top:0,bottom:0,left:0,right:0},duration:MOTION
    });
  });
  $('routesToggle').addEventListener('click',toggleRoutesTray);
  $('routesClose').addEventListener('click',()=>{
    closeRoutesTray();
    $('routesToggle').focus();
  });
  $('recalculate').addEventListener('click',()=>{closeRoutesTray();planRoute(true);});
  $('fit').addEventListener('click',()=>{closeRoutesTray();overview();});
  $('startPreview').addEventListener('click',startNavigationDemo);
  $('navPlay').addEventListener('click',toggleSim);
  $('navExit').addEventListener('click',stopNavigationDemo);
  $('navFollow').addEventListener('click',()=>{
    state.sim.follow=!state.sim.follow;
    $('navFollow').classList.toggle('selected',state.sim.follow);
    $('navFollow').setAttribute('aria-pressed',String(state.sim.follow));
    if(state.sim.follow)navCamera(along(state.sim.distance),true);
  });
  $('navScrub').addEventListener('input',event=>{
    pauseSim();
    state.sim.follow=false; // Don't spend map-tile requests scrubbing.
    $('navFollow').classList.remove('selected');
    $('navFollow').setAttribute('aria-pressed','false');
    positionSim(state.sim.length*Number(event.target.value)/1000);
  });
  $('recenter').addEventListener('click',()=>{
    if(state.mode==='navigation'){
      state.sim.follow=true;
      $('navFollow').classList.add('selected');
      $('navFollow').setAttribute('aria-pressed','true');
      navCamera(along(state.sim.distance),true);
    } else if(state.mode==='preview') overview();
    else state.map.easeTo({
      center:state.gps || DEMO_ORIGIN,zoom:state.gps?15.5:14.8,pitch:0,bearing:0,
      padding:{top:0,bottom:0,left:0,right:0},duration:MOTION
    });
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&state.sim.playing)pauseSim();
  });
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    if(!$('settingsPanel').hidden) $('settingsPanel').hidden=true;
    else if(!$('routesTray').hidden) closeRoutesTray();
    else if(state.mode==='search') backToIdle();
  });
}
initKey();
initMap();
attachEvents();
setMode('idle');
updateOriginLabel();
