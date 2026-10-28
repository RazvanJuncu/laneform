// Sampling every route update is CHEAP; downloading OSM is not.
// Advance a 300 m route-distance grid, reusing the reconstruction for all
// progress ticks within each window. The chosen center looks 140-440 m ahead.
// The caller applies its existing ≥30s OSM API cooldown and cache.
// A remote maneuver should not starve the first local Cruise scan.
// Within ~680m, favor Junction Detail to leave time for the public OSM
// cooldown; farther ahead, scan the local road first and then re-use its XML.
export function prioritizeJunctionDownload({
  aheadMeters,rollingStation=null,rollingCached=false,
  urgentMeters=680
}={}){
  if(!Number.isFinite(aheadMeters))return false;
  return aheadMeters<=urgentMeters||rollingStation===null||rollingCached;
}
export const ROLLING_STEP_METERS=300;
export const ROLLING_AREA_RADIUS_METERS=190;
export function nextRollingStation(progress,total,{
  step=ROLLING_STEP_METERS,lookAhead=140
}={}){
  if(!Number.isFinite(progress)||!Number.isFinite(total)||
    !Number.isFinite(step)||step<=0||total<180)return null;
  const station=Math.ceil((Math.max(0,progress)+lookAhead)/step)*step;
  return station>=total-20?null:station;
}
export function rollingAreaPoint(route,station,routeProfile,
  positionAtDistance){
  if(!route||!Number.isFinite(station)||typeof routeProfile!=='function'||
    typeof positionAtDistance!=='function')return null;
  const total=route.properties?.summary?.lengthInMeters;
  if(!Number.isFinite(total)||total<=0)return null;
  const profile=routeProfile(route);
  if(profile.length<1)return null;
  return positionAtDistance(profile,station/total*profile.length);
}
