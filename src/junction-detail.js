// Contextual street detail for navigation preview.
// Prepares ONE upcoming routed junction at a time, never per animation frame.
// Geometry is OSM-derived and schematic; no automatic lane choice is inferred.
import {buildJunctionTargets,upcomingJunction,junctionCacheKey,junctionViewMode}
  from './junction-logic.js';
import {smallAreaOsmUrl,MAX_OSM_BYTES,validateOsmXML,
  validateGeojson,blankCollection} from './street-geometry-adapter.js';
import {partitionJunctionGeometry} from './junction-focus.js';
import {candidateApproachLanePaths} from './lane-path-candidates.js';
import {setStreetBasemapHidden,forgetStreetBasemapStyle} from './street-basemap.js';

const DATA_SOURCE='glide-junction-lanes';
const FOCUS_SOURCE='glide-junction-focus';
const MARKS_SOURCE='glide-junction-markings';
const JUNCTION_SOURCE='glide-junction-lines';
const CANDIDATE_SOURCE='glide-junction-approach-candidates';
const COOLDOWN_MS=30000;
const MAX_CACHE=5;
const IDS=['glide-junction-surface','glide-junction-edges',
  'glide-junction-focus-fill','glide-junction-focus-edge',
  'glide-junction-paint','glide-junction-crossing',
  'glide-junction-approach-candidates'];
const EMPTY=blankCollection();
let enginePromise=null;

function parseOptional(json){
  try{return validateGeojson(json);}catch{return blankCollection();}
}
async function loadEngine(){
  if(!enginePromise){
    enginePromise=(async()=>{
      const path=import.meta.env.BASE_URL+'vendor/osm2streets_js.js';
      const lib=await import(/* @vite-ignore */ path);
      await lib.default();
      if(typeof lib.JsStreetNetwork!=='function')
        throw Error('osm2streets geometry engine missing');
      return lib;
    })().catch(error=>{enginePromise=null;throw error;});
  }
  return enginePromise;
}
async function reconstruct(xml){
  validateOsmXML(xml);
  const lib=await loadEngine();
  let net;
  try{
    net=new lib.JsStreetNetwork(xml,'',{
      osm2lanes:false,debug_each_step:false,dual_carriageway_experiment:false,
      sidepath_zipping_experiment:false,inferred_sidewalks:false,
      inferred_kerbs:false,date_time:null,override_driving_side:''
    });
    return {
      lanes:validateGeojson(net.toLanePolygonsGeojson()),
      markings:parseOptional(net.toLaneMarkingsGeojson()),
      junctions:parseOptional(net.toIntersectionMarkingsGeojson())
    };
  }finally{net?.free?.();}
}
async function downloadJunction(position){
  const url=smallAreaOsmUrl(position,135);
  const aborter=new AbortController();
  const timer=setTimeout(()=>aborter.abort(),12000);
  try{
    const response=await fetch(url,{signal:aborter.signal,credentials:'omit'});
    if(!response.ok)throw Error('OSM HTTP '+response.status);
    const bytes=Number(response.headers.get('content-length'));
    if(bytes>MAX_OSM_BYTES)throw Error('OSM area too large');
    const xml=await response.text();
    validateOsmXML(xml);
    return xml;
  }finally{clearTimeout(timer);}
}
// MapLibre rendering: route-matched nearby lane polygons stand out subtly;
// all other reconstructed arms remain context, not navigation instructions.
function styleLayers(map){
  if(!map?.isStyleLoaded?.())return false;
  for(const source of [DATA_SOURCE,FOCUS_SOURCE,MARKS_SOURCE,JUNCTION_SOURCE,CANDIDATE_SOURCE]){
    if(!map.getSource(source))map.addSource(source,{
      type:'geojson',data:EMPTY
    });
  }
  const fade={duration:650,delay:0};
  const layers=[
    {id:IDS[0],type:'fill',source:DATA_SOURCE,
      paint:{'fill-color':'#52636F','fill-opacity':.075,
        'fill-opacity-transition':fade}},
    {id:IDS[1],type:'line',source:DATA_SOURCE,
      paint:{'line-color':'#667B88','line-width':.65,
        'line-opacity':.12,'line-opacity-transition':fade}},
    {id:IDS[2],type:'fill',source:FOCUS_SOURCE,
      paint:{'fill-color':'#AFC4D0','fill-opacity':.205,
        'fill-opacity-transition':fade}},
    {id:IDS[3],type:'line',source:FOCUS_SOURCE,
      paint:{'line-color':'#C8D7E0','line-width':1.1,
        'line-opacity':.54,'line-opacity-transition':fade}},
    {id:IDS[4],type:'line',source:MARKS_SOURCE,
      paint:{'line-color':'#DDE7EC','line-width':1.3,
        'line-opacity':.67,'line-opacity-transition':fade}},
    {id:IDS[5],type:'line',source:JUNCTION_SOURCE,
      paint:{'line-color':'#738997','line-width':.75,
        'line-opacity':.16,'line-opacity-transition':fade}},
    // Only preliminary approach-lane hypotheses. Never draw across the
    // intersection: we have no verified lane-to-lane connector graph.
    {id:IDS[6],type:'line',source:CANDIDATE_SOURCE,
      paint:{'line-color':'#B4C8D5','line-width':2.5,
        'line-opacity':.82,'line-dasharray':[2.5,1.7],
        'line-opacity-transition':fade}}
  ];
  for(const layer of layers)if(!map.getLayer(layer.id))map.addLayer({
    ...layer,layout:{visibility:'none'}
  });
  return true;
}
function show(map,visible){
  if(!map?.isStyleLoaded?.())return;
  setStreetBasemapHidden(map,visible);
  const v=visible?'visible':'none';
  for(const id of IDS)if(map.getLayer(id) &&
    map.getLayoutProperty(id,'visibility')!==v)
      map.setLayoutProperty(id,'visibility',v);
}
function assign(map,data,selection,candidates){
  if(!styleLayers(map))return;
  map.getSource(DATA_SOURCE).setData(selection?.context||data?.lanes||EMPTY);
  map.getSource(FOCUS_SOURCE).setData(selection?.focus||EMPTY);
  map.getSource(MARKS_SOURCE).setData(selection?.markings||EMPTY);
  map.getSource(JUNCTION_SOURCE).setData(data?.junctions||EMPTY);
  map.getSource(CANDIDATE_SOURCE).setData(candidates||EMPTY);
}
export function createJunctionDetail({
  mapGetter,buttonGetter,onViewChange=()=>{},onButtonAction=()=>{}
}={}){
  const state={
    targets:[],target:null,currentKey:null,
    cache:new Map(),inflight:false,lastCall:0,generation:0,
    display:false,forced:null,dismissed:null,
    progress:0,route:null,reason:'not-requested',userZooming:false,
    pendingTimer:null
  };
  const map=()=>mapGetter?.();
  const button=()=>buttonGetter?.();
  const entry=()=>state.target?state.cache.get(junctionCacheKey(state.target.position)):null;
  function classifyTarget(next,cached){
    if(!state.route||!next||!cached?.data)return;
    cached.selection=partitionJunctionGeometry(cached.data,state.route,next.offset);
    cached.candidates=candidateApproachLanePaths(
      state.route,state.route.properties?.guidance?.instructions?.[next.index],
      cached.data.lanes.features);
  }
  function updateButton(){
    const b=button();
    if(!b)return;
    const e=entry();
    const d=state.target?.offset-state.progress??Infinity;
    b.hidden=!state.route || !state.target || d>700 || d < -35 ||
      !e?.data;
    if(!b.hidden){
      b.textContent=state.display?'Return to map':'Junction detail';
      b.setAttribute('aria-pressed',String(state.display));
      const count=e?.candidates?.features?.length||0;
      b.title=count
        ? count+' provisional approach-lane traces · no verified junction connectivity'
        : 'Schematic OSM geometry · no evidence-backed lane approach available';
    }
  }
  function updateAppearance(){
    const m=map(),e=entry();
    const previous=state.display;
    const center=m?.getCenter?.();
    const close=center&&state.target
      ?Math.hypot(
        (center.lng-state.target.position[0])*80000,
        (center.lat-state.target.position[1])*111000)
      :Infinity;
    state.display=junctionViewMode({
      target:state.target,progress:state.progress,loaded:!!e?.data,
      dismissedId:state.dismissed,forcedId:state.forced,
      zoom:m?.getZoom?.()??15.65,
      centerDistanceMeters:close
    })==='detail';
    if(m?.isStyleLoaded?.()){
      if(state.display && e?.data){
        styleLayers(m);
        if(state.currentKey!==junctionCacheKey(state.target.position)){
          assign(m,e.data,e.selection,e.candidates);
          state.currentKey=junctionCacheKey(state.target.position);
        }
        show(m,true);
      } else show(m,false);
    }
    updateButton();
    if(previous!==state.display)onViewChange(state.display);
  }
  function clearPending(){
    if(state.pendingTimer!==null)clearTimeout(state.pendingTimer);
    state.pendingTimer=null;
  }
  function ensureNextPrepared(){
    const next=state.target;
    if(!next || !state.route)return;
    const key=junctionCacheKey(next.position);
    if(state.cache.has(key))return;
    if(state.inflight)return; // finishing request will schedule the next
    const remaining=COOLDOWN_MS-(Date.now()-state.lastCall);
    if(remaining>0){
      clearPending();
      // One scheduled follow-up for the next selected junction; no polling.
      const generation=state.generation;
      state.pendingTimer=setTimeout(()=>{
        state.pendingTimer=null;
        if(generation===state.generation)ensureNextPrepared();
      },remaining+35);
      state.reason='cooldown';
      return;
    }
    clearPending();
    state.lastCall=Date.now();
    state.inflight=true;state.reason='loading';
    const generation=state.generation;
    void (async()=>{
      try{
        const xml=await downloadJunction(next.position);
        const data=await reconstruct(xml);
        if(generation!==state.generation)return;
        const cached={data,status:'ready'};
        classifyTarget(next,cached);
        state.cache.set(key,cached);
        if(state.cache.size>MAX_CACHE)state.cache.delete(state.cache.keys().next().value);
        state.reason='ready';
      }catch(error){
        if(generation!==state.generation)return;
        state.reason=error?.message||'unavailable';
        state.cache.set(key,{data:null,status:'unavailable'});
        console.info('Glide optional junction geometry:',state.reason);
      }finally{
        if(generation===state.generation){
          state.inflight=false;
          updateAppearance();
          // If the simulation already progressed past this junction while
          // the request ran, prepare the new target after the cooldown.
          if(state.target && junctionCacheKey(state.target.position)!==key)
            ensureNextPrepared();
        }
      }
    })();
  }
  function setTarget(next){
    const oldId=state.target?.id;
    if(next?.id===oldId)return;
    clearPending();
    state.target=next;
    state.forced=null;state.dismissed=null;
    state.currentKey=null;
    state.display=false;show(map(),false);
    updateButton();
    if(!next){
      updateAppearance();return;
    }
    // Geometry cache is geographic; lane approach metadata depends on the
    // SELECTED route and turn, so recompute on every target selection.
    classifyTarget(next,entry());
    ensureNextPrepared();
    updateAppearance();
  }
  function update(progress){
    if(!state.route||!Number.isFinite(progress))return;
    state.progress=progress;
    const next=upcomingJunction(state.targets,progress);
    setTarget(next);
    updateAppearance();
  }
  function begin(route){
    state.generation++;
    clearPending();
    state.route=route;state.targets=buildJunctionTargets(route);
    state.target=null;state.currentKey=null;
    state.forced=null;state.dismissed=null;
    state.display=false;state.inflight=false;
    show(map(),false);
    update(0);
  }
  function stop(){
    state.generation++;
    clearPending();
    state.route=null;state.target=null;
    state.display=false;state.forced=null;state.dismissed=null;
    state.inflight=false;show(map(),false);updateButton();
  }
  function toggle(){
    if(!state.target || !entry()?.data)return;
    if(state.display){
      state.forced=null;state.dismissed=state.target.id;
    }else{
      state.dismissed=null;state.forced=state.target.id;
    }
    updateAppearance();
    onButtonAction(state.display);
  }
  function userZoomEnd(){
    if(!state.route||!state.target||!entry()?.data)return;
    const zoom=map()?.getZoom?.()??0;
    if(zoom<17.35 && state.display){
      state.forced=null;state.dismissed=state.target.id;
    }else if(zoom>=18.05){
      state.dismissed=null;state.forced=state.target.id;
    }
    updateAppearance();
  }
  const m=map();
  m?.on('zoomstart',event=>{
    if(event.originalEvent)state.userZooming=true;
  });
  m?.on('zoomend',()=>{
    if(!state.userZooming)return;
    state.userZooming=false;userZoomEnd();
  });
  m?.on('style.load',()=>{
    forgetStreetBasemapStyle(m);
    state.currentKey=null;
    updateAppearance();
  });
  button()?.addEventListener('click',toggle);
  updateButton();
  return {
    begin,stop,update,toggle,
    active:()=>state.display,
    candidateCount:()=>entry()?.candidates?.features?.length||0,
    position:()=>state.target?.position||null,
    currentTarget:()=>state.target,
    info:()=>({
      targetCount:state.targets.length,
      ready:!!entry()?.data,
      routeNearbyShapes:entry()?.selection?.summary?.matchedCount||0,
      candidateLanePaths:entry()?.candidates?.features?.length||0,
      reason:state.reason,active:state.display,
      requesting:state.inflight
    })
  };
}
