// Glide's deliberately conservative lane-position continuity heuristic.
// "Leftmost to leftmost" is a plausible correspondence of ordinal positions,
// not a claim about legal lane-to-lane connections or the driver's current lane.
//
// Lane index in osm2streets is physical left-to-right for the road's forward
// geometry, so reverse it for Backward traffic to get the driver's left-to-right.
const allowedDirections=new Set(['Forward','Backward']);
const turnSet=new Set(['left','right','through']);
function drivingDirection(lane){
  return String(lane?.direction||lane?.properties?.direction||'');
}
function normalizedLane(lane){
  const p=lane?.properties||lane;
  if(!p||String(p.type).toLowerCase()!=='driving'||
    !Number.isInteger(p.road)||!Number.isInteger(p.index)||
    !allowedDirections.has(drivingDirection(p)))return null;
  return {road:p.road,index:p.index,direction:drivingDirection(p),
    allowed:Array.isArray(p.allowed_turns)?
      p.allowed_turns.map(t=>String(t).toLowerCase()):[]};
}
function ordered(lanes){
  return lanes.sort((a,b)=>a.direction==='Backward'
    ?b.index-a.index:a.index-b.index);
}
export function inferOrdinalContinuity(incoming,outgoing,{
  maneuver,roadConnectionConfirmed=false,restrictionsClear=false
}={}){
  const result={status:'insufficient-evidence',pairs:[],confidence:'none',
    reason:'No verified lane-level connector'};
  if(!roadConnectionConfirmed || !restrictionsClear){
    result.reason='Road connection or restrictions have not been established';
    return result;
  }
  if(!turnSet.has(maneuver)){
    result.reason='Unsupported maneuver';
    return result;
  }
  const from=(incoming||[]).map(normalizedLane);
  const to=(outgoing||[]).map(normalizedLane);
  if(from.length<1||to.length<1||
    from.includes(null)||to.includes(null)||from.length!==to.length){
    result.reason='Direction-specific lane counts missing or unequal';
    return result;
  }
  if(new Set(from.map(l=>l.road)).size!==1 ||
     new Set(to.map(l=>l.road)).size!==1 ||
     new Set(from.map(l=>l.direction)).size!==1 ||
     new Set(to.map(l=>l.direction)).size!==1){
    result.reason='Ambiguous approach or exit road directions';
    return result;
  }
  const keys=lanes=>new Set(lanes.map(l=>l.index));
  if(keys(from).size!==from.length||keys(to).size!==to.length){
    result.reason='Duplicate lane indices';
    return result;
  }
  // Missing / contrary explicit arrows aren't treated as permission.
  if(from.some(l=>!l.allowed.includes(maneuver))){
    result.reason='Approach arrows do not support every candidate lane';
    return result;
  }
  const incomingSorted=ordered(from),outgoingSorted=ordered(to);
  result.status='provisional';
  result.confidence='heuristic';
  result.reason='Equal directional lane counts and clear road-level movement; lane-to-lane connection still unverified';
  result.pairs=incomingSorted.map((lane,i)=>({
    fromRoad:lane.road,fromLane:lane.index,
    toRoad:outgoingSorted[i].road,toLane:outgoingSorted[i].index,
    ordinal:i+1,total:from.length,
    label:i===0?'leftmost':i===from.length-1?'rightmost':'inner',
    status:'ordinal-heuristic-not-verified'
  }));
  return result;
}

// Raw road connectivity from osm2streets' toGeojsonPlain export.
// Do not assume an OSM junction exists because road geometry overlaps.
export function hasRoadLevelMovement(features,fromRoad,toRoad){
  if(!Array.isArray(features)||!Number.isInteger(fromRoad)||
    !Number.isInteger(toRoad))return false;
  for(const feature of features){
    if(feature?.properties?.type!=='intersection')continue;
    const moves=feature.properties.movements;
    if(!Array.isArray(moves))continue;
    for(const move of moves){
      // osm2streets serializes road IDs as "n -> n" in the
      // intersection's road-level movement list.
      const match=String(move).match(/^\s*(\d+)\s*->\s*(\d+)\s*$/);
      if(match && Number(match[1])===fromRoad &&
        Number(match[2])===toRoad)return true;
    }
  }
  return false;
}
