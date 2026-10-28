import assert from 'node:assert/strict';
import {isJunctionPhase,stableMappedLaneGroup}
  from '../src/lane-junction-policy.js';
import {twoStageLaneGuidance} from '../src/lane-hud-model.js';
const group=(n,i,turns=[])=>({source:'glide',status:'inferred',
  laneCount:n,selected:[i],turns});
assert.equal(isJunctionPhase({targetOffset:610,progress:100}),false);
assert.equal(isJunctionPhase({targetOffset:610,progress:230}),true,
  'At exactly 380m until a known turn, Cruise yields to lane guidance');
assert.equal(isJunctionPhase({targetOffset:610,progress:630}),true);
assert.equal(isJunctionPhase({targetOffset:610,progress:646}),false,
  'Cruise resumes only after clearing the junction');
assert.equal(isJunctionPhase({targetOffset:null,progress:100}),false);
assert.equal(isJunctionPhase({targetOffset:900,
  throughOffset:310,progress:100}),true,
  'Significant mapped through intersection also suppresses Cruise');
assert.equal(twoStageLaneGuidance(group(1,0),group(1,0),80,{
  selectedTurnSide:'left'
}),null,'Do not invent a lane decision on 1-in/1-out');
const left=twoStageLaneGuidance(group(3,2),group(2,1),85,{
  selectedTurnSide:'left'
});
assert.deepEqual(left.selected,[0],
  'Left turn with no explicit OSM arrows defaults to leftmost approach');
assert.equal(left.exit,null,
  'No post-junction lane should be invented without a mapped connector');
assert.equal(left.selectionBasis,'driver-side-default');
const right=twoStageLaneGuidance(group(3,0),group(3,0),85,{
  selectedTurnSide:'right'
});
assert.deepEqual(right.selected,[2]);
assert.equal(right.exit,null,
  'Right turn does not prove which post-junction lane is connected');
const tagged=twoStageLaneGuidance(group(3,1,['through','left']),
  group(2,0),85,{selectedTurnSide:'left'});
assert.deepEqual(tagged.selected,[1],
  'Explicit left-compatible OSM tagging overrides default leftmost heuristic');
const connected=twoStageLaneGuidance(group(3,1),{
  ...group(3,1),explicitLaneConnection:true
},85,{selectedTurnSide:'left'});
assert.deepEqual(connected.exit.selected,[1],
  'Verified lane connectivity, if available, overrides heuristic exit');
const frames=[-60,-55,-50].map(at=>({
  at:240+at,road:18,direction:'Forward',laneCount:3,
  selected:1,offsets:[-5,-1.5,2.1]
}));
assert.deepEqual(stableMappedLaneGroup(frames,240,'left').selected,[0]);
assert.deepEqual(stableMappedLaneGroup(frames,240,'right').selected,[2]);
assert.equal(stableMappedLaneGroup([frames[0]],240,'left'),null,
  'No lane count claimed from one isolated polygon sample');
assert.equal(stableMappedLaneGroup(frames.map(f=>({
  ...f,offsets:[-5,-1.5+(f.at-185)*.5,2.1]
})),240,'left'),null,'Reject conflicting lane boundaries');
console.log('Glide junction-only lane HUD and turn-side defaults passed.');
