// Read-only, privacy-safe explanation of every visibility decision.
const finite=Number.isFinite;
const dist=v=>finite(v)?Math.round(v)+' m':'—';
export function evaluateGlideDiagnostics(info={},context={}){
 const route=!!context.routeActive,phase=info.guidanceMode||'cruise';
 const rolling=info.rollingCoverage||{},cruise=info.cruiseGuidance;
 const cooldown=finite(info.cooldownRemainingMs)?Math.ceil(Math.max(0,info.cooldownRemainingMs)/1000):0;
 const station=rolling.activeStation;
 const fail=(rolling.failures||[]).find(e=>e.offset===station)||(rolling.failures||[])[0];
 const ready=(rolling.readyStations||[]).includes(station);
 const hasGeometry=!!info.ready||ready;
 const count=(info.lanePolygons||0)+(info.mappedLaneFrames||0);
 let cs,cw,cn;
 if(!route){cs='inactive';cw='Start a route preview.';}
 else if(phase==='junction'){cs='suppressed';cw='Junction mode deliberately hides Cruise, even if Suggested Lanes is unavailable.';}
 else if(cruise?.laneCount>1){cs='ready';cw=cruise.mode==='turn-only'?'Explicit OSM through/turn-only evidence.'
  :cruise.mode==='continuity'?'Mapped lane continuity shows a lane diverging.'
  :cruise.mode==='alignment'?'Inferred alignment for next routed turn.':'Multiple mapped lanes; no supported preferred lane.';}
 else if(info.requesting){cs='pending';cw='OSM download or reconstruction currently running.';}
 else if(fail&&!ready){cs='blocked';cw='Rolling OSM window failed: '+fail.message;}
 else if(cooldown&&!hasGeometry){cs='waiting';cw='OSM request cooldown: '+cooldown+'s remaining.';}
 else if(!hasGeometry){cs='no-coverage';cw='No prepared OSM road geometry available near this position.';}
 else if(!count){cs='no-lanes';cw='OSM reconstruction produced no usable lane cross-sections.';}
 else {cs='insufficient';cw='Mapped geometry has no confirmed multi-lane choice or stable route-continuity evidence.';}
 let js,jw;
 if(!route){js='inactive';jw='Start a route preview.';}
 else if(!finite(info.targetOffsetMeters)){js='no-target';jw='No upcoming TomTom maneuver target. Crossing streets alone may not trigger a junction preview.';}
 else if(!info.ready){js=info.requesting?'pending':info.targetCacheStatus==='unavailable'?'blocked':'waiting';
  jw=info.targetCacheStatus==='unavailable'?'OSM reconstruction failed: '+(info.targetError||info.reason||'unknown')
   :info.requesting?'Next junction OSM geometry is loading.'
   :cooldown?'Junction request is queued behind '+cooldown+'s cooldown.':'Next junction is not reconstructed yet.';}
 else if(info.dismissedPreview){js='dismissed';jw='Junction preview manually dismissed for this target.';}
 else if(info.distanceToTargetMeters>380&&!info.forcedPreview){js='ahead';jw='Next junction '+dist(info.distanceToTargetMeters)+' away; auto preview begins at 380 m.';}
 else if(info.viewReason==='map-not-ready'){js='waiting';jw='Map style not ready to display overlay.';}
 else if(info.active){js='visible';jw='Junction preview active on the map.';}
 else {js='hidden';jw='Geometry available but Junction Detail currently hidden; inspect distance/zoom/dismissal.';}
 let ls,lw;
 if(phase!=='junction'){ls='inactive';lw='Square lane guidance runs only in junction phase.';}
 else if(info.hudGuidance){ls='ready';lw='A multi-lane approach or exit selection is available.';}
 else if(!info.ready){ls='waiting';lw='Waiting for mapped junction lane geometry.';}
 else if(info.corridorStatus!=='provisional'){ls='blocked';lw='Lane corridor failed: '+(info.corridorReason||'insufficient OSM metadata');}
 else {ls='insufficient';lw='Corridor exists but no supported 2+ lane recommendation was produced.';}
 const counters={
  routeProgress:dist(info.progressMeters),nextTurnDistance:dist(info.distanceToTargetMeters),
  routeLength:dist(context.routeLengthMeters),targetCount:info.targetCount||0,
  lanePolygons:info.lanePolygons||0,laneFrames:info.mappedLaneFrames||0,
  explicitTurnPolygons:info.cruiseDiagnostics?.explicitTurnTagPolygons||0,
  foundStraightCrossings:info.cruiseDiagnostics?.throughCandidates||0,
  corridorStatus:info.corridorStatus||'unavailable',
  corridorSamples:info.corridorSamples||0,
  rollingRequests:rolling.requestedStations||0,rollingReady:(rolling.readyStations||[]).length,
  rollingFailed:(rolling.failures||[]).length,
  activeStation:dist(station),cooldownSeconds:cooldown,
  currentRequest:info.requestStage||'idle',zoom:finite(info.zoom)?Number(info.zoom.toFixed(1)):null
 };
 return {version:context.version||'unknown',
  recordedAt:new Date(context.now||Date.now()).toISOString(),
  simulation:!route?'inactive':context.simPlaying?'playing':'paused',phase,
  sections:[
   {key:'cruise',title:'Cruise',status:cs,reason:cw},
   {key:'junction',title:'Intersection preview',status:js,reason:jw},
   {key:'lanes',title:'Suggested lanes',status:ls,reason:lw}
  ],counters,
  scanner:{stage:info.requestStage||'idle',lastError:info.lastOSMError||null,
   failures:(rolling.failures||[]).slice(0,4).map(x=>({
    station:dist(x.offset),error:x.message
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
