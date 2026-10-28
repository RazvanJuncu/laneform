// One source of truth for swapping the quiet Cruise strip for detailed
// square lane guidance at a junction. Do NOT tie this to whether OSM
// finished loading: navigation knows the upcoming maneuver in advance.
export const JUNCTION_LEAD_METERS=380;
export const JUNCTION_CLEARANCE_METERS=35;
export function isJunctionPhase({
  targetOffset=null,progress=0,
  lead=JUNCTION_LEAD_METERS,clearance=JUNCTION_CLEARANCE_METERS
}={}){
  if(!Number.isFinite(progress))return false;
  const close=offset=>Number.isFinite(offset)&&
    offset-progress<=lead&&offset-progress>=-clearance;
  // Straight crossings belong to the rolling Cruise analysis only.
  return close(targetOffset);
}
// Fallback when the chosen green corridor has usable multi-lane polygons
// but the original lane ordinal is missing or unstable. Require repeated
// cross-sections on the same arm before showing any square.
export function stableMappedLaneGroup(frames=[],offset,side='through',{
  after=false
}={}){
  if(!Array.isArray(frames)||!Number.isFinite(offset))return null;
  const candidate=frames.filter(f=>Number.isFinite(f?.at)&&
    f.laneCount>=2&&f.laneCount<=9&&
    Array.isArray(f.offsets)&&f.offsets.length===f.laneCount&&
    f.offsets.every(Number.isFinite)&&
    (after?f.at>=offset+14&&f.at<=offset+115:
      f.at>=offset-150&&f.at<=offset-8));
  const anchor=offset+(after?45:-55);
  candidate.sort((a,b)=>Math.abs(a.at-anchor)-Math.abs(b.at-anchor));
  for(const f of candidate){
    const peers=candidate.filter(p=>p.road===f.road&&
      p.direction===f.direction&&p.laneCount===f.laneCount&&
      Math.abs(p.at-f.at)<=17&&p.offsets.every((v,j)=>
        Math.abs(v-f.offsets[j])<=1.3));
    if(peers.length<2||
      Math.max(...peers.map(x=>x.at))-Math.min(...peers.map(x=>x.at))<4)
      continue;
    const ordinal=side==='left'?0:side==='right'?f.laneCount-1:
      Number.isInteger(f.selected)&&f.selected>=0&&f.selected<f.laneCount
        ?f.selected:Math.floor((f.laneCount-1)/2);
    return {source:'glide',status:'inferred',
      laneCount:f.laneCount,selected:[ordinal],
      road:f.road,direction:f.direction,sourceDetail:'stable-mapped-group'};
  }
  return null;
}
