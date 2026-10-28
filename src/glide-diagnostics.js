// Read-only, privacy-safe explanation of every visibility decision.
const finite=Number.isFinite;
const dist=v=>finite(v)?Math.round(v)+' m':'—';
const safeError=value=>String(value||'unknown')
 .replace(/(?:https?:\/\/)[^\s)]+/gi,'[URL withheld]')
 .replace(/(?:api[_-]?key|token|access[_-]?key)\s*[=:]\s*[^\s&]+/gi,'[credential withheld]')
 .replace(/sk-[a-z0-9_-]{8,}/gi,'[credential withheld]')
 .replace(/-?\d{1,3}\.\d{4,}/g,'[coordinate withheld]')
 .slice(0,160);
export function evaluateGlideDiagnostics(info={},context={}){
 const route=!!context.routeActive,phase=info.guidanceMode||'cruise';
 const rolling=info.rollingCoverage||{},cruise=info.cruiseGuidance;
 const osm=info.osmTransport||{};
 const cache=osm.localCache||{};
 const sourcePause=Number.isFinite(osm.pauseRemainingMs)?Math.ceil(osm.pauseRemainingMs/1000):0;
 const cooldown=finite(info.cooldownRemainingMs)?Math.ceil(Math.max(0,info.cooldownRemainingMs)/1000):0;
 const playbackRate=finite(context.playbackRate)?context.playbackRate:1;
 const travelDuringCooldown=cooldown*12.5*playbackRate;
 const station=rolling.activeStation;
 const fail=(rolling.failures||[]).find(e=>e.offset===station)||(rolling.failures||[])[0];
 const ready=(rolling.readyStations||[]).includes(station);
 const hasGeometry=!!info.ready||ready;
 const count=(info.lanePolygons||0)+(info.mappedLaneFrames||0);
 let cs,cw,cn;
 if(!route){cs='inactive';cw='Start a route preview.';}
 else if(phase==='junction'){cs='suppressed';cw='Junction mode deliberately hides Cruise, even if Suggested Lanes is unavailable.';}
 else if(cruise?.mode==='available'&&(!cruise.selected||!cruise.selected.length)){
  cs='insufficient';cw='Mapped lane count only; no route-valid lane can be selected.';
 }
 else if(cruise?.laneCount>1){cs='ready';cw=cruise.mode==='turn-only'?'Explicit OSM through/turn-only evidence.'
  :cruise.mode==='continuity'?'Mapped lane continuity shows a lane diverging.'
  :cruise.mode==='alignment'?'Inferred alignment for next routed turn.'
  :cruise.mode==='available'?'Mapped lane count only; no route-valid lane is established.'
  :'Mapped lanes present, but no reliable selection established.';}
 else if(info.requesting){cs='pending';cw='OSM download or reconstruction currently running.';}
 else if(sourcePause&&!hasGeometry){cs='waiting';cw='OSM sources resting after repeated errors: '+sourcePause+'s remaining.';}
 else if(fail&&!ready){cs='blocked';cw='Rolling OSM window failed: '+safeError(fail.message);}
 else if(cooldown&&!hasGeometry){cs='waiting';cw='OSM request cooldown: '+cooldown+'s remaining.';}
 else if(!hasGeometry){cs='no-coverage';cw=(rolling.requestedStations||0)===0
  ?'The rolling scanner has not completed an OSM request yet.'
  :'No reconstructed OSM road geometry is available near this position.';}
 else if(!count){cs='no-lanes';cw='OSM reconstruction produced no usable lane cross-sections.';}
 else {cs='insufficient';cw='Mapped geometry has no confirmed multi-lane choice or stable route-continuity evidence.';}
 let js,jw;
 if(!route){js='inactive';jw='Start a route preview.';}
 else if(!finite(info.targetOffsetMeters)){js='no-target';jw='No actionable routed turn ahead. Straight-through crossings stay in Cruise and do not open a turn-style preview.';}
 else if(finite(info.distanceToTargetMeters)&&
   info.distanceToTargetMeters>(info.junctionPrefetchLookaheadMeters||850)&&
   !info.ready){
   js='distant';jw='Next actionable turn is '+dist(info.distanceToTargetMeters)+
     ' away. Dedicated OSM prefetch is intentionally deferred until '+
     (info.junctionPrefetchLookaheadMeters||850)+' m; rolling Cruise owns the intervening road.';
 }
 else if(!info.ready){js=info.targetCacheStatus==='unavailable'?'blocked':info.requestStage==='junction-download'||info.requestStage==='junction-reconstruct'?'pending':'waiting';
  jw=info.targetCacheStatus==='unavailable'?'OSM reconstruction failed: '+safeError(info.targetError||info.reason||'unknown')
   :info.requestStage==='junction-download'||info.requestStage==='junction-reconstruct'?'Next junction OSM geometry is loading.'
   :sourcePause?'OSM sources resting for '+sourcePause+'s after errors.'
   :cooldown?'Junction request queued for '+cooldown+'s. At the current simulation playback rate the vehicle may travel '+dist(travelDuringCooldown)+' before a new request can begin.':'Next junction is not reconstructed yet.';}
 else if(info.dismissedPreview){js='dismissed';jw='Junction preview manually dismissed for this target.';}
 else if(info.distanceToTargetMeters>380&&!info.forcedPreview){js='ahead';jw='Next junction '+dist(info.distanceToTargetMeters)+' away; auto preview begins at 380 m.';}
 else if(info.viewReason==='map-not-ready'){js='waiting';jw='Map style not ready to display overlay.';}
 else if(info.active){js='visible';jw='Junction preview active on the map.';}
 else {js='hidden';jw='Geometry available but Junction Detail currently hidden; inspect distance/zoom/dismissal.';}
 let ls,lw;
 if(phase!=='junction'){ls='inactive';lw='Square lane guidance runs only in junction phase.';}
 else if(info.hudGuidance||context.providerLanesAvailable){
  ls='ready';lw=info.hudGuidance
    ?'OSM mapped approach lane selection; geometric reconstruction is provisional.'
    :'TomTom route lane recommendation is available without another API request.';
 }
 else if(!info.ready){ls=info.targetCacheStatus==='unavailable'||sourcePause?'unavailable':'waiting';lw=info.targetCacheStatus==='unavailable'||sourcePause?'Lane geometry unavailable; road-level turn guidance continues.':'Preparing optional lane geometry.';}
 else if(info.corridorStatus!=='provisional'){ls='blocked';lw='Lane corridor failed: '+(info.corridorReason||'insufficient OSM metadata');}
 else {ls='insufficient';lw='Corridor exists but no supported 2+ lane recommendation was produced.';}
 const counters={
  routeProgress:dist(info.progressMeters),nextTurnDistance:dist(info.distanceToTargetMeters),
  routeLength:dist(context.routeLengthMeters),targetCount:info.targetCount||0,
  lanePolygons:info.lanePolygons||0,laneFrames:info.mappedLaneFrames||0,
  explicitTurnPolygons:info.cruiseDiagnostics?.explicitTurnTagPolygons||0,
  foundStraightCrossings:(info.cruiseDiagnostics?.throughCandidates||0)+
   (info.cruiseDiagnostics?.rollingThroughCandidates||0),
  rollingLaneFrames:info.cruiseDiagnostics?.rollingMappedLaneFrames||0,
  corridorStatus:info.corridorStatus||'unavailable',
  corridorSamples:info.corridorSamples||0,
  cruiseMode:cruise?.mode||'none',
  cruiseSelected:Array.isArray(cruise?.selected)
    ?cruise.selected.map(i=>i+1).join(', ')||'none':'none',
  cruiseConfidence:cruise?.confidence||cruise?.status||'none',
  junctionGeometrySource:info.ready?info.geometrySource||'unknown':'not-ready',
  activeLaneGuidanceSource:info.hudGuidance?'osm2streets':
    context.providerLanesAvailable?'tomtom-route':'none',
  junctionPrefetch:info.junctionPrefetchEligible?'imminent turn':'deferred',
  straightCrossingPreview:'Cruise-only',
  cachedJunctionReuses:info.reusedJunctions||0,
  reusedFromStation:dist(info.reusedFromStation),
  rollingRequests:rolling.requestedStations||0,rollingReady:(rolling.readyStations||[]).length,
  rollingFailed:(rolling.failures||[]).length,
  activeStation:dist(station),cooldownSeconds:cooldown,
  playbackRate:playbackRate+'×',
  estimatedTravelDuringCooldown:dist(travelDuringCooldown),
  currentRequest:info.requestStage||'idle',zoom:finite(info.zoom)?Number(info.zoom.toFixed(1)):null,
  osmProvider:osm.source||'unknown',osmProviderFailures:osm.consecutiveFailures||0,
  osmProviderBackoffSeconds:sourcePause,
  localGeometryCacheEntries:cache.entries||0,
  localGeometryCacheHits:cache.hits||0,
  localGeometryCacheWrites:cache.writes||0,
  localGeometryCacheStorage:cache.persistent?'on-device':'memory-only'
 };
 return {version:context.version||'unknown',
  recordedAt:new Date(context.now||Date.now()).toISOString(),
  simulation:!route?'inactive':context.simPlaying?'playing':'paused',phase,
  sections:[
   {key:'cruise',title:'Cruise',status:cs,reason:cw},
   {key:'junction',title:'Intersection preview',status:js,reason:jw},
   {key:'lanes',title:'Suggested lanes',status:ls,reason:lw}
  ],counters,
  scanner:{stage:info.requestStage||'idle',lastError:info.lastOSMError?safeError(info.lastOSMError):null,
   source:osm.source||'unknown',backoffSeconds:sourcePause,
   localGeometryCacheEntries:cache.entries||0,
   localGeometryCacheHits:cache.hits||0,
   failures:(rolling.failures||[]).slice(0,4).map(x=>({
    station:dist(x.offset),error:safeError(x.message)
   })),
   stationEvidence:(rolling.laneFramesPerStation||[]).slice(-7).map(x=>({
    station:dist(x.offset),frames:x.frames,
    corridor:x.corridorStatus,crossings:x.throughCrossings
   }))},
  note:'No API keys, precise coordinates, origin/destination, or raw route geometry included.'
 };
}
export function diagnosticsText(s){
 const out=['Glide diagnostics '+s.version,s.recordedAt,
  'Simulation: '+s.simulation+' / '+s.phase];
 for(const x of s.sections)out.push(x.title+' ['+x.status+']: '+x.reason);
 out.push('Counters: '+JSON.stringify(s.counters),
  'Scanner: '+JSON.stringify(s.scanner),s.note);
 return out.join('\n');
}
