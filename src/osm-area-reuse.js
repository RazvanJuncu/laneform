// Reuse locally reconstructed OSM areas across Cruise and Junction Detail.
// OSM /map bbox replies may include ways extending beyond their bounds,
// but we only reuse that extra geometry when the *actual new junction*
// has mapped samples on both sides of the route. Never infer coverage
// solely because a window's center is geographically nearby.
const rad=Math.PI/180;
export function distanceMeters(a,b){
  if(!Array.isArray(a)||!Array.isArray(b)||
    !a.every(Number.isFinite)||!b.every(Number.isFinite))return Infinity;
  const lat=(a[1]+b[1])*.5*rad;
  return Math.hypot((a[0]-b[0])*111320*Math.cos(lat),
    (a[1]-b[1])*110540);
}
export function reusableAreaCandidates({
  route,target,rollingCache,routeProfile,positionAtDistance,
  radiusMeters=190,extraWayMeters=65
}={}){
  if(!target?.position||!rollingCache||
    typeof routeProfile!=='function'||
    typeof positionAtDistance!=='function')return [];
  const total=route?.properties?.summary?.lengthInMeters;
  if(!Number.isFinite(total)||total<=0)return [];
  const path=routeProfile(route);
  if(!path?.length)return [];
  return [...rollingCache.entries()].filter(([,value])=>!!value?.data)
    .map(([station,value])=>{
      const center=positionAtDistance(path,station/total*path.length);
      return {station,value,center,distance:distanceMeters(center,target.position)};
    }).filter(x=>x.distance<=radiusMeters+extraWayMeters)
    .sort((a,b)=>a.distance-b.distance);
}
export function reconstructedJunctionCovered(corridor,offset,{
  minSamples=2,nearMeters=125
}={}){
  if(corridor?.status!=='provisional'||!Array.isArray(corridor.laneFrames)||
    !Number.isFinite(offset))return false;
  const before=corridor.laneFrames.filter(f=>
    f.at>=offset-nearMeters&&f.at<=offset-9);
  const after=corridor.laneFrames.filter(f=>
    f.at>=offset+9&&f.at<=offset+nearMeters);
  return before.length>=minSamples&&after.length>=minSamples;
}
