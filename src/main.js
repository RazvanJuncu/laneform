import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import { calculateRoute, discoverPlaces } from '@tomtom-org/maps-sdk/services';
import { Map as MapLibreMap, Marker, LngLatBounds, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import mapStyle from './glide-map-style.json';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

setWorkerUrl(workerUrl);

const $ = id => document.getElementById(id);
const BUCHAREST = [26.1025, 44.4397];
const DEMO_ORIGIN = [26.061, 44.429]; // Approximate, not lane-verified.
const SIGNAL = '#D7F36A';
const ROUTE_TTL = 120000;
const SEARCH_TTL = 1800000;
const REQUEST_GAP = 12000;
const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOTION = isReducedMotion ? 0 : 520;
const state = {
  map: null, mapReady: false, mode: 'planning',
  key: '', query: '', destinationName: '', destination: null,
  originMode: 'demo', gps: null, gpsMarker: null,
  routes: null, selected: 0, busy: false, routeMarkers: [],
  searchCache: new Map(), routeSignature: '', routeAt: 0, attemptAt: 0,
  calls: { search: 0, route: 0 }, trafficAvailable: false, lastTrafficAt: 0,
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
  $('plan').firstChild.textContent = value ? 'Calculating… ' : 'Find a route ';
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
    for (const type of ['search', 'route']) {
      if (Number.isSafeInteger(count?.[type]) && count[type] >= 0) state.calls[type] = count[type];
    }
  } catch {}
  $('usageCounter').textContent = state.calls.search + ' searches · ' + state.calls.route + ' routes this tab';
  if (state.key) TomTomConfig.instance.put({ apiKey: state.key, language: 'en-GB' });
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
  state.mode = mode;
  document.body.dataset.mode = mode;
  $('planningSheet').hidden = mode !== 'planning';
  $('previewSheet').hidden = mode !== 'preview';
  $('navHUD').hidden = mode !== 'navigation';
  $('navBar').hidden = mode !== 'navigation';
  $('settingsPanel').hidden = true;
  $('recenter').title = mode === 'navigation' ? 'Follow simulated vehicle' : 'Fit map';
  if (mode !== 'navigation') $('laneGuidance').hidden = true;
}

// Map: user-visible cartography is supplied by OpenFreeMap / OSM, not TomTom.
// Traffic flow tiles are separate and only requested with a planned route.
function initMap() {
  const map = new MapLibreMap({
    container: 'map', style: structuredClone(mapStyle), center: BUCHAREST,
    zoom: 11.8, maxZoom: 19.5, pitch: 0, bearing: 0,
    attributionControl: true, refreshExpiredTiles: false,
    antialias: true
  });
  state.map = map;
  map.on('style.load', () => {
    state.mapReady = true;
    $('mapState').classList.add('ready');
    $('mapState').lastChild.textContent = ' Map ready';
    requestDraw();
  });
  map.on('move', requestDraw);
  map.on('resize', requestDraw);
  map.on('moveend', () => {
    updateTrafficVisibility();
    requestDraw();
  });
  map.on('error', e => console.warn('Glide map tile/style issue:', e.error || e));
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
  if (!state.routes || state.mode === 'planning') return;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  const stroke = (feature, color, strokeWidth, opacity, blur = 0) => {
    const segments = routeSegments(feature);
    ctx.save();
    ctx.lineWidth = strokeWidth; ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    if (blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
    for (const segment of segments) {
      ctx.beginPath();
      let first = true;
      for (const c of segment) {
        if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
        const p = map.project(c);
        if (first) { ctx.moveTo(p.x,p.y); first = false; }
        else ctx.lineTo(p.x,p.y);
      }
      if (!first) ctx.stroke();
    }
    ctx.restore();
  };
  state.routes.features.forEach((route, i) => {
    if (i !== state.selected) stroke(route, '#8AA0AD', 3.6, .42);
  });
  const feature = selectedRoute();
  if (!feature) return;
  // Glow replaces the old thick black outline; the sharp core remains legible.
  stroke(feature, SIGNAL, 11, .23, 14);
  stroke(feature, SIGNAL, 6.2, .99);
  stroke(feature, '#F4FFD4', 1.6, .58);
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
  const bottom = mobile ? Math.min(350, Math.round(innerHeight * .44)) : 320;
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
  if (start) state.routeMarkers.push(new Marker({color:'#D7F36A',scale:.72}).setLngLat(start).addTo(state.map));
  if (state.destination) state.routeMarkers.push(new Marker({color:'#D6E0E5',scale:.82}).setLngLat(state.destination).addTo(state.map));
}
function trafficUrl() {
  return 'https://api.tomtom.com/traffic/map/4/tile/flow/relative-delay/{z}/{x}/{y}.pbf?key='
    + encodeURIComponent(state.key);
}
function updateTrafficVisibility() {
  const map = state.map;
  if (!map || !state.mapReady) return;
  const active = $('trafficToggle').checked && !!state.routes && !!state.key && map.getZoom() >= 12;
  const sourceId = 'glide-traffic', layerId = 'glide-traffic-delays';
  if (!map.getSource(sourceId)) {
    if (!active) return;
    try {
      map.addSource(sourceId, {type:'vector',tiles:[trafficUrl()],minzoom:0,maxzoom:16});
      map.addLayer({
        id: layerId, source: sourceId, 'source-layer': 'Traffic flow', type:'line',
        filter:['any',
          ['==',['get','road_closure'],true],
          ['all',['has','traffic_level'],['<',['to-number',['get','traffic_level'],1],.60]]
        ],
        layout:{'line-cap':'round','line-join':'round'},
        paint:{
          'line-color':['case',
            ['==',['get','road_closure'],true],'#E55555',
            ['<',['to-number',['get','traffic_level'],1],.35],'#E55555',
            '#F3A94B'],
          'line-width':['interpolate',['linear'],['zoom'],12,2.1,16,4.3],
          'line-opacity':.84
        }
      });
      state.trafficAvailable = true;
      state.lastTrafficAt = Date.now();
    } catch (error) { console.warn('Optional traffic overlay unavailable:', error); }
  } else if (map.getLayer(layerId)) {
    const target = active ? 'visible' : 'none';
    if (map.getLayoutProperty(layerId,'visibility') !== target)
      map.setLayoutProperty(layerId,'visibility',target);
  }
}
function setOrigin(mode) {
  state.originMode = mode;
  $('demoOrigin').classList.toggle('selected',mode==='demo');
  $('gpsOrigin').classList.toggle('selected',mode==='gps');
  if (mode !== 'gps') return;
  if (!navigator.geolocation) { toast('Browser location unavailable.',true); return; }
  toast('Requesting your location…');
  navigator.geolocation.getCurrentPosition(pos => {
    const p = [pos.coords.longitude,pos.coords.latitude];
    state.gps = p;
    if (state.gpsMarker) state.gpsMarker.setLngLat(p);
    else {
      const dot = document.createElement('div');
      dot.className='gps-dot';
      state.gpsMarker=new Marker({element:dot}).setLngLat(p).addTo(state.map);
    }
    toast('Location found · ±'+Math.round(pos.coords.accuracy)+' m accuracy.');
    state.map.easeTo({center:p,zoom:14.4,duration:MOTION});
  },err => {
    toast('Location unavailable: '+err.message,true);
    state.originMode='demo';
    $('demoOrigin').classList.add('selected');
    $('gpsOrigin').classList.remove('selected');
  },{enableHighAccuracy:true,maximumAge:5000,timeout:16000});
}
function origin() { return state.originMode==='gps' ? state.gps : DEMO_ORIGIN; }

// Search and routing are explicit, throttled and cached within this tab.
async function planRoute(force = false) {
  if (state.busy || !state.mapReady) return;
  if (!state.key) { showSettings(); toast('Add your TomTom key to plan a route.',true); return; }
  const start = origin();
  if (!start) { toast('Waiting for your GPS location.',true); return; }
  const query = $('destination').value.trim();
  if (!query) { toast('Enter a destination.',true); return; }
  const now = Date.now();
  const signature = norm(query)+'|'+pointKey(start);
  if (state.routes && signature === state.routeSignature && now-state.routeAt < ROUTE_TTL) {
    if (force) toast('Live traffic was checked recently. Try again shortly.');
    else { refreshMarkers(); setMode('preview'); renderPreview(); overview(); toast('Using your recent route.'); }
    return;
  }
  if (now-state.attemptAt < REQUEST_GAP) {
    toast('Request limit: try again in '+Math.ceil((REQUEST_GAP-(now-state.attemptAt))/1000)+' seconds.');
    return;
  }
  state.attemptAt=now;
  uiBusy(true);
  try {
    let location;
    const cached = state.searchCache.get(norm(query));
    if (force && state.destination && signature===state.routeSignature) {
      location=state.destination;
    } else if (cached && now-cached.at < SEARCH_TTL) {
      location=cached.position;
      state.destinationName=cached.name;
    } else {
      const text = /bucurești|bucharest/i.test(query) ? query : query+', București, Romania';
      addCall('search');
      const results=await discoverPlaces({query:text,geoBias:{position:BUCHAREST},limit:5});
      const place=results?.features?.[0];
      if (!place?.geometry?.coordinates) throw new Error('Destination not found. Try a more precise address.');
      location=place.geometry.coordinates;
      state.destinationName=place.properties?.poi?.name ||
        place.properties?.address?.freeformAddress || query;
      state.searchCache.set(norm(query),{position:location,name:state.destinationName,at:now});
    }
    state.destination=location;
    addCall('route');
    const result=await calculateRoute({
      locations:[start,location], travelMode:'car',maxAlternatives:2,
      guidance:{type:'coded'},costModel:{routeType:'fast',traffic:'live'}
    });
    if (!result?.features?.length || !routeSegments(result.features[0]).length)
      throw new Error('Routing did not return a usable road geometry.');
    state.routes=result;
    state.routeSignature=signature;
    state.routeAt=Date.now();
    state.selected=0;
    refreshMarkers();
    setMode('preview');
    renderPreview();
    overview();
    updateTrafficVisibility();
  } catch (e) {
    console.error('Glide route planning:',e);
    toast('Route unavailable: '+(e?.message||'check routing permission'),true);
  } finally { uiBusy(false); }
}
function renderPreview() {
  const route=selectedRoute();
  if (!route) return;
  const summary=route.properties?.summary || {};
  $('previewDestination').textContent=state.destinationName || $('destination').value.trim();
  $('summaryTime').textContent=minutes(summary.travelTimeInSeconds);
  $('summaryLength').textContent=distance(summary.lengthInMeters);
  const delay=summary.trafficDelayInSeconds || 0;
  $('summaryDelay').textContent=delay>40?minutes(delay)+' traffic delay':'Live traffic included';
  const target=$('routeChoices');
  target.replaceChildren();
  state.routes.features.forEach((r,index)=>{
    const button=document.createElement('button');
    button.type='button';
    button.className='route-option'+(index===state.selected?' selected':'');
    const label=document.createElement('span');
    label.textContent=index===0?'Best route':'Option '+(index+1);
    const duration=document.createElement('strong');
    duration.textContent=minutes(r.properties?.summary?.travelTimeInSeconds);
    button.append(label,duration);
    button.addEventListener('click',()=>{
      state.selected=index;renderPreview();requestDraw();overview();
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
  const road=instruction?.nextRoadInfo?.streetName?.text;
  return road ? 'Continue toward '+road : 'Continue along the highlighted route';
}
function renderVerifiedLanes(laneData){
  // This hook is reserved for verified provider/road data only. No fake lane
  // diagrams are shown. Phone GPS does not identify the current lane.
  const panel=$('laneGuidance');
  panel.replaceChildren();
  panel.hidden=true;
  if(!laneData?.verified||!Array.isArray(laneData.lanes)||!laneData.lanes.length)return;
  const label=document.createElement('strong');
  label.textContent=laneData.message||'Upcoming lane guidance';
  panel.append(label);
  panel.hidden=false;
}
function navCamera(p,immediate=false){
  if(!state.sim.follow||!state.map)return;
  const now=performance.now();
  if(!immediate && now-state.sim.lastCamera<720)return;
  state.sim.lastCamera=now;
  const h=window.innerHeight;
  const padding={top:Math.round(h*.40),bottom:Math.round(h*.12),left:0,right:0};
  state.map.easeTo({
    center:p.point,bearing:p.angle,pitch:59,zoom:15.65,
    padding,duration:immediate?MOTION:670
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
  const next=instructions.find(x=>Number.isFinite(x.routeOffsetInMeters)&&x.routeOffsetInMeters>offset+12);
  $('navDistance').textContent=next?distance(next.routeOffsetInMeters-offset):'Arriving';
  $('navInstruction').textContent=next?turnLabel(next):'Approaching your destination';
  $('navArrow').textContent=turnArrow(next);
  $('navRemaining').textContent=distance(Math.max(0,realLength-offset));
  const timeLeft=(summary.travelTimeInSeconds||0)*(1-fraction);
  $('navTime').textContent=timeLeft>1?minutes(timeLeft):'0 min';
  const expectedArrival=new Date(Date.now()+timeLeft*1000);
  $('navETA').textContent=expectedArrival.toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'});
  $('navScrub').value=String(Math.round(fraction*1000));
  renderVerifiedLanes(null);
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
  state.routeMarkers.forEach(marker=>marker.getElement().style.display='');
  setMode('preview');
  overview();
}

function attachEvents(){
  $('routeForm').addEventListener('submit',e=>{e.preventDefault();planRoute();});
  $('demoOrigin').addEventListener('click',()=>setOrigin('demo'));
  $('gpsOrigin').addEventListener('click',()=>setOrigin('gps'));
  $('settingsOpen').addEventListener('click',()=>{
    $('settingsPanel').hidden?showSettings():$('settingsPanel').hidden=true;
  });
  $('settingsClose').addEventListener('click',()=>{$('settingsPanel').hidden=true;});
  $('saveKey').addEventListener('click',saveKey);
  $('apiKey').addEventListener('keydown',e=>{if(e.key==='Enter')saveKey();});
  $('trafficToggle').addEventListener('change',updateTrafficVisibility);
  $('backToPlanning').addEventListener('click',()=>{
    // Keep the latest route cached, but don't draw it in planning mode.
    state.routeMarkers.forEach(x=>x.remove());
    state.routeMarkers=[];
    setMode('planning');
    requestDraw();
    state.map.easeTo({pitch:0,bearing:0,padding:{top:0,bottom:0,left:0,right:0},duration:MOTION});
  });
  $('recalculate').addEventListener('click',()=>planRoute(true));
  $('fit').addEventListener('click',overview);
  $('startPreview').addEventListener('click',startNavigationDemo);
  $('navPlay').addEventListener('click',toggleSim);
  $('navExit').addEventListener('click',stopNavigationDemo);
  $('navFollow').addEventListener('click',()=>{
    state.sim.follow=!state.sim.follow;
    $('navFollow').classList.toggle('selected',state.sim.follow);
    $('navFollow').setAttribute('aria-pressed',String(state.sim.follow));
    if(state.sim.follow)navCamera(along(state.sim.distance),true);
  });
  $('navScrub').addEventListener('input',e=>{
    pauseSim();
    state.sim.follow=false; // avoid repeated tile loading during scrubbing
    $('navFollow').classList.remove('selected');
    $('navFollow').setAttribute('aria-pressed','false');
    positionSim(state.sim.length*Number(e.target.value)/1000);
  });
  $('recenter').addEventListener('click',()=>{
    if(state.mode==='navigation'){
      state.sim.follow=true;
      $('navFollow').classList.add('selected');
      $('navFollow').setAttribute('aria-pressed','true');
      navCamera(along(state.sim.distance),true);
    }else if(state.mode==='preview')overview();
    else state.map.easeTo({center:BUCHAREST,zoom:11.8,pitch:0,bearing:0,padding:{top:0,bottom:0,left:0,right:0},duration:MOTION});
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&state.sim.playing)pauseSim();
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape')$('settingsPanel').hidden=true;
  });
}
initKey();
initMap();
attachEvents();
setMode('planning');
