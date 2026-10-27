// Stage 1 shows the approach lane early. Stage 2 shows the mapped exit
// lane closer to the intersection. Both originate from the same geometry
// already painted in the Glide lane corridor. No TomTom lane-arrow fallback.
export const EXIT_LANE_REVEAL_METERS=115;
export const WIDENING_REVEAL_METERS=160;
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
    revealMeters=EXIT_LANE_REVEAL_METERS,
    nearApproach=null,wideningRevealMeters=WIDENING_REVEAL_METERS,
    selectedTurnSide=null
  }={}
){
  if(!validLaneSelection(approach)||
    !Number.isFinite(distanceToManeuver)||
    distanceToManeuver<0||distanceToManeuver>700)return null;
  const shown=validLaneSelection(exit)&&distanceToManeuver<=revealMeters;
  // The early row describes the roadway BEFORE it widens. Closer to the
  // turn, switch to the actual mapped lane count in the final approach.
  // Don't advertise a dedicated turning lane hundreds of metres early.
  const widening=validLaneSelection(nearApproach)&&
    nearApproach.laneCount>approach.laneCount&&
    distanceToManeuver<=wideningRevealMeters;
  const selected=widening?nearApproach:approach;
  // Driver-style default for a turn when no explicitly compatible
  // OSM turn:lanes instruction is available: leftmost for left turns,
  // rightmost for right turns. Explicit tagging always overrides this.
  const explicitTurns=Array.isArray(selected.turns)?
    selected.turns:[];
  const hasMappedDirection=selectedTurnSide&&explicitTurns.some(t=>
    t===selectedTurnSide||t.endsWith('_'+selectedTurnSide));
  const defaultIndex=selectedTurnSide==='left'?0:
    selectedTurnSide==='right'?selected.laneCount-1:null;
  const guidedApproach=defaultIndex!==null&&!hasMappedDirection
    ?{...selected,selected:[defaultIndex],
      selectionBasis:'driver-side-default'}:selected;
  // The ordinary exit mapping has no explicit lane-to-lane connection;
  // preserve a verified lane connector if one becomes available.
  const guidedExit=validLaneSelection(exit)&&defaultIndex!==null&&
    !exit.explicitLaneConnection
    ?{...exit,selected:[selectedTurnSide==='left'?0:exit.laneCount-1],
      selectionBasis:'driver-side-default'}:exit;
  // A 1->1 passage requires no lane decision. Suppress the whole HUD,
  // including boring straight-through crossings, unless a lane really
  // appears or the outgoing lane group has multiple choices.
  const hasExitChoices=validLaneSelection(exit)&&exit.laneCount>1;
  if(approach.laneCount===1&&!widening&&!hasExitChoices)
    return null;
  // The '+' marks the NEWLY APPEARING lane, not necessarily the selected
  // one. A turn-only lane usually opens toward its matching turn side.
  // Avoid pretending the added side is verified when maneuver is unknown.
  const addedCount=widening?selected.laneCount-approach.laneCount:0;
  const side=widening&&selectedTurnSide==='left'?'left':
    widening&&selectedTurnSide==='right'?'right':null;
  const addedLaneIndices=side==='left'
    ?Array.from({length:addedCount},(_,i)=>i)
    :side==='right'
      ?Array.from({length:addedCount},(_,i)=>
        selected.laneCount-addedCount+i):[];
  return {...guidedApproach,distanceToManeuver,
    widensFrom:widening?approach.laneCount:null,
    addedLaneIndices,
    exit:shown?guidedExit:null,exitRevealMeters:revealMeters};
}
