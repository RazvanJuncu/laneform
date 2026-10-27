// Contextual street detail for navigation preview.
// Prepares ONE upcoming routed junction at a time, never per animation frame.
// Geometry is OSM-derived; provisional lane-level planning is for preview only.
import {buildJunctionTargets,upcomingJunction,junctionCacheKey,junctionViewMode}
  from './junction-logic.js';
import {smallAreaOsmUrl,MAX_OSM_BYTES,validateOsmXML,
  validateGeojson,blankCollection} from './street-geometry-adapter.js';
import {partitionJunctionGeometry} from './junction-focus.js';
import {simplifiedJunctionGeometry} from './junction-simplified-map.js';
import {twoStageLaneGuidance} from './lane-hud-model.js';
import {cruiseFromMappedLanes} from './lane-cruise.js';
import {sampleImportantThroughJunctions}
  from './junction-straight-sampling.js';
import {candidateApproachLanePaths,expectedLaneTurn} from './lane-path-candidates.js';
import {buildJunctionOrdinalCandidates} from './junction-lane-bridge.js';
import {planJunctionTrajectory} from './junction-driver-planner.js';
import {buildLaneCorridor} from './junction-road-corridor.js';
import {setStreetBasemapHidden,forgetStreetBasemapStyle} from './street-basemap.js';

const DATA_SOURCE='glide-junction-lanes';
const FOCUS_SOURCE='glide-junction-focus';
const MARKS_SOURCE='glide-junction-markings';
const JUNCTION_SOURCE='glide-junction-lines';
const CANDIDATE_SOURCE='glide-junction-approach-candidates';
const EXIT_SOURCE='glide-junction-provisional-exits';
const PATH_SOURCE='glide-junction-driver-trajectory';
const COOLDOWN_MS=30000;
const MAX_CACHE=5;
const IDS=['glide-junction-surface','glide-junction-edges',
  'glide-junction-focus-fill','glide-junction-focus-edge',
  'glide-junction-paint','glide-junction-crossing',
  'glide-junction-approach-candidates',
  'glide-junction-provisional-exits',
  'glide-junction-driver-trajectory-halo',
  'glide-junction-driver-trajectory'];
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
      junctions:parseOptional(net.toIntersectionMarkingsGeojson()),
      roads:parseOptional(net.toGeojsonPlain())
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
  for(const source of [DATA_SOURCE,FOCUS_SOURCE,MARKS_SOURCE,JUNCTION_SOURCE,CANDIDATE_SOURCE,EXIT_SOURCE,PATH_SOURCE]){
    if(!map.getSource(source))map.addSource(source,{
      type:'geojson',data:EMPTY
    });
  }
  const fade={duration:650,delay:0};
  const layers=[
    {id:IDS[0],type:'fill',source:DATA_SOURCE,
      paint:{'fill-color':'#263A45','fill-opacity':.64,
        'fill-opacity-transition':fade}},
    {id:IDS[1],type:'line',source:DATA_SOURCE,
      paint:{'line-color':'#526875','line-width':.65,
        'line-opacity':.22,'line-opacity-transition':fade}},
    {id:IDS[2],type:'fill',source:FOCUS_SOURCE,
      paint:{'fill-color':'#40545D','fill-opacity':.47,
        'fill-opacity-transition':fade}},
    {id:IDS[3],type:'line',source:FOCUS_SOURCE,
      paint:{'line-color':'#94A7AE','line-width':.7,
        'line-opacity':.22,'line-opacity-transition':fade}},
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
        'line-opacity-transition':fade}},
    {id:IDS[7],type:'line',source:EXIT_SOURCE,
      paint:{'line-color':'#A4B9C6','line-width':2,
        'line-opacity':.55,'line-dasharray':[1.8,2.1],
        'line-opacity-transition':fade}},
    {id:IDS[8],type:'line',source:PATH_SOURCE,
      paint:{'line-color':'#4BDABA','line-width':9,
        'line-opacity':.20,'line-blur':4,
        'line-opacity-transition':fade}},
    {id:IDS[9],type:'line',source:PATH_SOURCE,
      paint:{'line-color':'#67ECCD','line-width':4.2,
        'line-opacity':.96,'line-opacity-transition':fade}}
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
  for(const id of IDS){
    if(!map.getLayer(id))continue;
    // Only draw simple drivable road surfaces and faint lane divisions.
    // Original OSM markings, arrows, intersection debug geometry, candidate
    // traces and duplicate path layers clutter the driver's overhead view.
    const actual=[IDS[0],IDS[1],IDS[2],IDS[3]].includes(id)?v:'none';
    if(map.getLayoutProperty(id,'visibility')!==actual)
      map.setLayoutProperty(id,'visibility',actual);
  }
}
function assign(map,data,selection,candidates,ordinal,planner,corridor){
  if(!styleLayers(map))return;
  const simplified=simplifiedJunctionGeometry(data,selection);
  map.getSource(DATA_SOURCE).setData(simplified.roads);
  map.getSource(FOCUS_SOURCE).setData(simplified.focus);
  // OSM markings and raw debug traces are kept for analysis, but do not
  // compete with Glide's clean, lane-centered route visualization.
  map.getSource(MARKS_SOURCE).setData(EMPTY);
  map.getSource(JUNCTION_SOURCE).setData(EMPTY);
  map.getSource(CANDIDATE_SOURCE).setData(EMPTY);
  map.getSource(EXIT_SOURCE).setData(EMPTY);
  // Only the geometry-first corridor is displayed as a lane trajectory.
  // Keep legacy ordinal guesses available for diagnostics, not navigation.
  map.getSource(PATH_SOURCE).setData(
    corridor?.status==='provisional'?corridor.path:EMPTY);
}
export function createJunctionDetail({
  mapGetter,buttonGetter,onViewChange=()=>{},
  onButtonAction=()=>{},onGuidanceChange=()=>{}
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
  function activeGuidance(){
    const e=entry(),target=state.target;
    if(!target)return null;
    // Favor an upcoming significant STRAIGHT-through crossing in the same
    // cached OSM area. Both the map and mini HUD must switch together.
    const straight=(e?.throughGuidance||[]).find(t=>
      t.corridor?.status==='provisional'&&
      !!twoStageLaneGuidance(
        t.corridor.recommendation,
        t.corridor.exitRecommendation,t.offset-state.progress,{
          nearApproach:t.corridor.nearApproachRecommendation
        })&&
      t.offset-state.progress>=-15&&t.offset-state.progress<=200&&
      t.offset<target.offset-45);
    return straight
      ?{kind:'through',offset:straight.offset,corridor:straight.corridor}
      :{kind:'maneuver',offset:target.offset,corridor:e?.corridor};
  }
  function cruiseHint(){
    const e=entry(),target=state.target;
    if(!e?.data||!state.route||!target)return null;
    // Include explicit TomTom STRAIGHT instructions as through candidates,
    // plus 3+arm crossings discovered independently from cached osm2streets.
    const instruction=state.route.properties?.guidance?.instructions?.[target.index];
    const through=(e.throughGuidance||[]).slice();
    if(expectedLaneTurn(instruction)==='through'&&e.corridor)
      through.push({offset:target.offset,corridor:e.corridor});
    const upcoming=state.targets.map(t=>({
      offset:t.offset,
      turn:expectedLaneTurn(
        state.route.properties?.guidance?.instructions?.[t.index])
    })).filter(t=>/left|right/.test(t.turn||'')&&
      t.offset>state.progress);
    const nearest=upcoming[0];
    return cruiseFromMappedLanes({
      laneFeatures:e.data.lanes?.features||[],
      throughGuidance:through,progress:state.progress,
      nextTurnOffset:nearest?.offset??null,
      nextTurnDirection:/left/.test(nearest?.turn||'')?'left':
        /right/.test(nearest?.turn||'')?'right':null
    });
  }
  function usableTrajectory(){
    if(!state.route||!state.target)return null;
    const remaining=state.target.offset-state.progress;
    if(!Number.isFinite(remaining)||remaining>700||remaining< -35)
      return null;
    const corridor=activeGuidance()?.corridor;
    if(corridor?.status!=='provisional')return null;
    const features=corridor.path?.features||[];
    if(!features.length||features.length!==corridor.coverage?.length)
      return null;
    return {features,coverage:corridor.coverage,source:'glide'};
  }
  function classifyTarget(next,cached){
    if(!state.route||!next||!cached?.data)return;
    cached.selection=partitionJunctionGeometry(cached.data,state.route,next.offset);
    const instruction=state.route.properties?.guidance?.instructions?.[next.index];
    cached.candidates=candidateApproachLanePaths(
      state.route,instruction,cached.data.lanes.features);
    cached.ordinal=buildJunctionOrdinalCandidates({
      route:state.route,instruction,
      approaches:cached.candidates.features,
      reconstructed:cached.data.lanes.features,
      roads:cached.data.roads?.features||[]
    });
    // The next maneuver is available from the selected route even when its
    // own OSM area has not been fetched. No additional TomTom API calls.
    const following=state.targets
      .filter(t=>t.offset>next.offset+1 && t.offset-next.offset<=350)
      .slice(0,4).map(t=>({
        offset:t.offset,
        instruction:state.route.properties?.guidance?.instructions?.[t.index]
      }));
    cached.planner=planJunctionTrajectory({
      route:state.route,instruction,
      reconstructed:cached.data.lanes.features,
      roads:cached.data.roads?.features||[],
      next:following
    });
    // Geometry-first corridor: supports ordinary through-junctions, short
    // reconstructed segments, and lane polygons without turn:lanes tags.
    cached.corridor=buildLaneCorridor({
      route:state.route,offset:next.offset,instruction,
      lanes:cached.data.lanes.features,next:following
    });
    // Sample important 3+ arm OSM intersections where the route stays
    // straight, even if TomTom issued no maneuver instruction there.
    // Restricted to the OSM area already fetched for this junction.
    const exclusions=state.targets.map(t=>t.offset);
    cached.throughGuidance=sampleImportantThroughJunctions({
      route:state.route,
      roads:cached.data.roads?.features||[],
      centerOffset:next.offset,excludeOffsets:exclusions,
      beforeMeters:300
    }).slice(-3).map(straight=>({
      ...straight,
      corridor:buildLaneCorridor({
        route:state.route,offset:straight.offset,
        instruction:{maneuver:'STRAIGHT',
          routeOffsetInMeters:straight.offset},
        lanes:cached.data.lanes.features,
        next:[{offset:next.offset,instruction},...following]
      })
    }));
  }
  function updateButton(){
    const b=button();
    if(!b)return;
    const e=entry();
    const d=state.target?.offset-state.progress??Infinity;
    b.hidden=!state.route || !state.target || d>700 || d < -35 ||
      !e?.data;
    if(!b.hidden){
      b.textContent=state.display
        ? e?.corridor?.status==='provisional'
          ? 'Return to map · inferred lanes' : 'Return to map · road-level'
        : 'Junction detail';
      b.setAttribute('aria-pressed',String(state.display));
      const count=e?.candidates?.features?.length||0;
      const pairs=e?.ordinal?.pairs?.length||0;
      b.title=e?.corridor?.status==='provisional'
        ? e.corridor.samples+' inferred lane-line points across '+
          e.corridor.coverage.length+' segments. Not verified driving guidance.'
        : 'No reliable local lane corridor: '+(e?.corridor?.reason||'missing geometry')+
          '. '+count+' tagged approach lanes, '+pairs+' ordinal candidates.';
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
          assign(m,e.data,e.selection,e.candidates,e.ordinal,e.planner,e.corridor);
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
          // Data readiness can change while playback is paused. Refresh the
          // same lane guidance shown on the map without waiting for movement.
          onGuidanceChange();
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
    onGuidanceChange();
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
    // The lane navigator is not dependent on whether the user has opened
    // the enlarged intersection diagram. The same reconstructed path should
    // render on the main map as soon as it is ready.
    hasTrajectory:()=>!!usableTrajectory(),
    coverage:()=>usableTrajectory()?.coverage||[],
    trajectory:()=>usableTrajectory(),
    position:()=>state.target?.position||null,
    currentTarget:()=>state.target,
    laneState:()=>{
      if(!state.display||!state.target)return null;
      if(activeGuidance()?.kind==='through' ||
        expectedLaneTurn(state.route?.properties?.guidance?.
          instructions?.[state.target.index])==='through')return null;
      const e=entry();
      if(!e?.data)return {status:e?.status==='unavailable'?'unavailable':'loading',
        description:e?.status==='unavailable'
          ?'OSM lane geometry unavailable':'Preparing reconstructed lanes'};
      const corridor=activeGuidance()?.corridor;
      if(corridor?.recommendation)return null;
      // A map may already have an inferred lane trajectory without knowing
      // the number/order of approach lanes. Do not incorrectly call that
      // a road-level (TomTom-only) route in the HUD.
      if(corridor?.status==='provisional')return {
        status:'trajectory-only',
        description:corridor.reason||
          'Mapped trajectory available, approach lane count unavailable'
      };
      return {
        status:'road-level',
        description:corridor?.reason||
          'No reliable local lane trajectory for this junction'
      };
    },
    cruise:()=>cruiseHint(),
    suggestedLanes:()=>{
      const g=activeGuidance();
      // Ordinary straight-ahead lanes belong in the compact persistent
      // CRUISE strip, never duplicate the large turn-preparation HUD.
      if(g?.kind==='through'||
        (g?.kind==='maneuver'&&expectedLaneTurn(
          state.route?.properties?.guidance?.instructions?.[
            state.target?.index])==='through'))return null;
      const ahead=g?.offset-state.progress;
      // Even a straight-through OSM crossing uses the exact lane corridor
      // drawn on the map; nothing independent is invented for the HUD.
      const currentInstruction=g?.kind==='maneuver'
        ?state.route?.properties?.guidance?.instructions?.[state.target?.index]
        :null;
      const maneuver=expectedLaneTurn(currentInstruction);
      const selectedTurnSide=/left/.test(maneuver||'')?'left':
        /right/.test(maneuver||'')?'right':null;
      const value=twoStageLaneGuidance(
        g?.corridor?.recommendation,
        g?.corridor?.exitRecommendation,ahead,{
          nearApproach:g?.corridor?.nearApproachRecommendation,
          selectedTurnSide
        });
      return value?{...value,kind:g.kind}:null;
    },
    info:()=>({
      targetCount:state.targets.length,
      ready:!!entry()?.data,
      routeNearbyShapes:entry()?.selection?.summary?.matchedCount||0,
      candidateLanePaths:entry()?.candidates?.features?.length||0,
      ordinalPairs:entry()?.ordinal?.pairs?.length||0,
      plannedTrajectory:entry()?.planner?.status||'unavailable',
      corridorStatus:entry()?.corridor?.status||'unavailable',
      corridorReason:entry()?.corridor?.reason||'No corridor data',
      corridorDiagnostics:entry()?.corridor?.diagnostics||null,
      simplifiedRoadCount:entry()?.data?
        simplifiedJunctionGeometry(entry().data,entry()?.selection).roadCount:0,
      simplifiedFocusCount:entry()?.data?
        simplifiedJunctionGeometry(entry().data,entry()?.selection).focusCount:0,
      trajectoryPainter:'canvas-above-map',
      mapTrajectoryFeatures:entry()?.corridor?.path?.features?.length||0,
      corridorSamples:entry()?.corridor?.samples||0,
      corridorCoverage:entry()?.corridor?.coverage||[],
      hudLaneRecommendation:entry()?.corridor?.recommendation||null,
      hudNearApproach:entry()?.corridor?.nearApproachRecommendation||null,
      hudExitRecommendation:entry()?.corridor?.exitRecommendation||null,
      osmThroughJunctions:entry()?.throughGuidance?.map(t=>({
        offset:t.offset,arms:t.arms,
        corridorStatus:t.corridor?.status||'unavailable'
      }))||[],
      activeGuidanceKind:activeGuidance()?.kind||null,
      cruiseGuidance:cruiseHint(),
      activeGuidanceOffsetMeters:activeGuidance()?.offset??null,
      plannedLaneSelection:entry()?.planner?.selected||null,
      nextManeuverLookahead:entry()?.planner?.lookahead||null,
      targetOffsetMeters:state.target?.offset??null,
      progressMeters:state.progress,
      distanceToTargetMeters:state.target?state.target.offset-state.progress:null,
      zoom:map()?.getZoom?.()??null,
      laneTrajectoryAvailable:!!usableTrajectory(),
      reason:state.reason,active:state.display,
      requesting:state.inflight
    })
  };
}
