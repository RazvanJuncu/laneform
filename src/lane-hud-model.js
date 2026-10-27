// Stage 1 shows the approach lane early. Stage 2 shows the mapped exit
// lane closer to the intersection. Both originate from the same geometry
// already painted in the Glide lane corridor. No TomTom lane-arrow fallback.
export const EXIT_LANE_REVEAL_METERS=115;
export function validLaneSelection(value){
  return value?.source==='glide'&&value.status==='inferred'&&
    Number.isInteger(value.laneCount)&&value.laneCount>=1&&
    value.laneCount<=9&&Array.isArray(value.selected)&&
    value.selected.length>=1&&
    value.selected.every(i=>Number.isInteger(i)&&i>=0&&
      i<value.laneCount);
}
export function twoStageLaneGuidance(
  approach,exit,distanceToManeuver,{
    revealMeters=EXIT_LANE_REVEAL_METERS
  }={}
){
  if(!validLaneSelection(approach)||
    !Number.isFinite(distanceToManeuver)||
    distanceToManeuver<0||distanceToManeuver>700)return null;
  const shown=validLaneSelection(exit)&&distanceToManeuver<=revealMeters;
  return {...approach,distanceToManeuver,
    exit:shown?exit:null,exitRevealMeters:revealMeters};
}
