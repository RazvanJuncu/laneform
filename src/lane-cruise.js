// Low-profile, persistent lane-awareness guidance while the routed movement
// continues straight. It uses EXPLICIT osm2streets turn markings on an already
// reconstructed road. No new network calls, no TomTom lane-arrow fallback.
// A lack of tagged turn restrictions means NO lane suggestion.
const clean=value=>String(value??'').trim().toLowerCase();
const knownRoad=x=>x===null||x===undefined?null:String(x);
const direction=value=>{
  const s=clean(value);
  return s==='forward'||s==='backward'?s:null;
};
function laneDescription(feature){
  const p=feature?.properties||{};
  const t=clean(p.type??p.lane_type??p.laneType);
  if(!['driving','drive','motorvehicle','motorcar','vehicular'].includes(t))
    return null;
  const road=knownRoad(p.road??p.road_id??p.roadId);
  const dir=direction(p.direction??p.dir);
  const index=Number(p.index??p.lane_index??p.laneIndex);
  if(!road||!dir||!Number.isInteger(index)||index<0||index>50)return null;
  const allowed=Array.isArray(p.allowed_turns)
    ?p.allowed_turns.map(clean).filter(Boolean):[];
  const through=allowed.some(t=>t==='through'||t==='straight');
  const forcedTurn=allowed.length>0&&!through&&allowed.every(t=>
    /(^|_)left$|(^|_)right$|uturn|reverse/.test(t));
  return {road,dir,index,allowed,through,forcedTurn};
}
export function cruiseFromMappedLanes({
  laneFeatures=[],throughGuidance=[],progress=0,
  nextTurnOffset=null,nextTurnDirection=null,
  horizonMeters=360
}={}){
  if(!Array.isArray(laneFeatures)||!Array.isArray(throughGuidance)||
    !Number.isFinite(progress))return null;
  const laneGroups=laneFeatures.map(laneDescription).filter(Boolean);
  const approaching=throughGuidance
    .filter(j=>j?.corridor?.status==='provisional'&&
      j.corridor?.recommendation&&
      Number.isFinite(j.offset)&&j.offset-progress>=18&&
      j.offset-progress<=horizonMeters)
    .sort((a,b)=>a.offset-b.offset);
  for(const candidate of approaching){
    const rec=candidate.corridor.recommendation;
    if(rec.source!=='glide'||rec.status!=='inferred'||
      !Number.isInteger(rec.laneCount)||rec.laneCount<2||
      rec.laneCount>9)continue;
    // Match the exact reconstructed approach ROAD and DIRECTION. Never
    // apply the opposite carriageway's markings to the selected route.
    const recDir=direction(rec.direction),road=knownRoad(rec.road);
    if(!road||!recDir)continue;
    const group=laneGroups.filter(l=>l.road===road&&l.dir===recDir);
    const map=new Map();
    for(const lane of group){
      const previous=map.get(lane.index);
      // Conflicting duplicates cannot justify a driving recommendation.
      if(previous&&(
        previous.through!==lane.through||
        previous.forcedTurn!==lane.forcedTurn
      ))map.set(lane.index,{...lane,conflict:true});
      else if(!previous)map.set(lane.index,lane);
    }
    if(map.size!==rec.laneCount||[...map.values()].some(l=>l.conflict))
      continue;
    const ordered=[...map.values()].sort((a,b)=>
      recDir==='backward'?b.index-a.index:a.index-b.index);
    const through=ordered.flatMap((lane,i)=>lane.through?[i]:[]);
    const forced=ordered.flatMap((lane,i)=>lane.forcedTurn?[i]:[]);
    // No explicit safety-relevant distinction? Stay quiet. A map with
    // three generic lanes is not proof which one will remain available.
    if(!through.length||!forced.length)continue;
    // The current lane may be on a different index than the HUD approach
    // anchor. Don't assert device/GPS can detect the occupied physical lane.
    const nextGap=Number.isFinite(nextTurnOffset)
      ?nextTurnOffset-candidate.offset:Infinity;
    const nextSide=nextGap>=30&&nextGap<=450
      ?nextTurnDirection:null;
    const ideal=nextSide==='left'?0:nextSide==='right'
      ?ordered.length-1:(ordered.length-1)/2+.25;
    const selected=[...through].sort((a,b)=>
      Math.abs(a-ideal)-Math.abs(b-ideal)||a-b)[0];
    return {
      source:'glide',status:'inferred',kind:'cruise',
      laneCount:ordered.length,selected:[selected],
      allowedThrough:through,turnOnly:forced,
      distanceToJunction:candidate.offset-progress,
      reason:'OSM explicitly maps through and turn-only lanes',
      offset:candidate.offset
    };
  }
  return null;
}
