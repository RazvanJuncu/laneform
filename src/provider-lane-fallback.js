// Zero-request fallback for a real routed turn.
// Only data already included in the selected TomTom route is used.
// No exit-lane or lane-to-lane connection is inferred.
export function providerTurnLaneHud(guidance){
  if(guidance?.source!=='tomtom'||
     guidance.status!=='provider-recommendation'||
     !Array.isArray(guidance.lanes)||guidance.lanes.length<2||
     guidance.lanes.length>9||
     !Number.isFinite(guidance.distanceToManeuver)||
     guidance.distanceToManeuver<12||
     guidance.distanceToManeuver>380)return null;
  const selected=guidance.lanes.flatMap((lane,index)=>
    lane.recommended&&lane.follow&&
      Array.isArray(lane.directions)&&lane.directions.includes(lane.follow)
      ?[index]:[]);
  if(!selected.length)return null;
  return {
    source:'tomtom',status:'provider-recommendation',kind:'maneuver',
    laneCount:guidance.lanes.length,selected,
    distanceToManeuver:guidance.distanceToManeuver,
    selectionBasis:'provider-route-guidance',
    confidence:'provider',exit:null
  };
}
