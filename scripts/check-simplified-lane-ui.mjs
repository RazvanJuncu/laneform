import assert from 'node:assert/strict';
import {twoStageLaneGuidance,validLaneSelection,EXIT_LANE_REVEAL_METERS}
  from '../src/lane-hud-model.js';
import {simplifiedJunctionGeometry}
  from '../src/junction-simplified-map.js';
const lane=(count,index)=>({source:'glide',status:'inferred',
  laneCount:count,selected:[index],road:9});
assert.equal(EXIT_LANE_REVEAL_METERS,115);
assert.equal(validLaneSelection(lane(3,1)),true);
assert.equal(validLaneSelection({...lane(2,0),status:'verified'}),false);
const early=twoStageLaneGuidance(lane(3,1),lane(2,0),360);
assert.deepEqual(early.selected,[1]);
assert.equal(early.exit,null,
  'Exit lane information must not appear too early');
const near=twoStageLaneGuidance(lane(3,1),lane(2,0),88);
assert.deepEqual(near.selected,[1]);
assert.deepEqual(near.exit.selected,[0],
  'Use distinct mapped approach and destination lane choices');
assert.equal(twoStageLaneGuidance(lane(3,1),lane(2,0),-40),null);
assert.equal(twoStageLaneGuidance(lane(3,1),null,70).exit,null);
const mappedExpansion=lane(2,0);
const distantWidening=twoStageLaneGuidance(lane(1,0),null,230,{
  nearApproach:mappedExpansion
});
assert.equal(distantWidening.laneCount,1,
  'Avoid showing a second lane long before it physically begins');
assert.equal(distantWidening.widensFrom,null);
const finalWidening=twoStageLaneGuidance(lane(1,0),null,131,{
  nearApproach:mappedExpansion
});
assert.equal(finalWidening.laneCount,2,
  'Final approach uses the mapped lane count after the split');
assert.deepEqual(finalWidening.selected,[0]);
assert.equal(finalWidening.widensFrom,1,
  'Mark the HUD as upcoming roadway widening');
assert.equal(twoStageLaneGuidance(lane(1,0),null,90,{
  nearApproach:{...mappedExpansion,selected:[3]}
}).laneCount,1,'Reject invalid widening geometry');
assert.equal(twoStageLaneGuidance(lane(3,1),{
  ...lane(2,0),selected:[4]
},60).exit,null,'Do not invent incorrect exit-lane squares');

const polygon=type=>({type:'Feature',properties:{type},
  geometry:{type:'Polygon',coordinates:[[
    [26,44],[26.0001,44],[26.0001,44.0001],
    [26,44.0001],[26,44]
  ]]}});
const driving=polygon('Driving'),sidewalk=polygon('Sidewalk'),
  bike=polygon('Cycling'),marking={type:'Feature',
    properties:{type:'Driving'},
    geometry:{type:'LineString',coordinates:[[26,44],[26.0001,44]]}};
const map=simplifiedJunctionGeometry({
  lanes:{features:[driving,sidewalk,bike,marking]}
},{focus:{features:[driving,sidewalk,marking]}});
assert.equal(map.roadCount,1,
  'Only driving-area polygons should enter our simplified map');
assert.equal(map.focusCount,1);
assert.equal(map.roads.features[0],driving);
assert.equal(map.focus.features[0],driving);
console.log('Glide two-stage HUD model and simplified-roadway map tests passed.');
