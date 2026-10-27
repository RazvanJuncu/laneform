import assert from 'node:assert/strict';
import {routeProfile} from '../src/osm-lane-geometry.js';
import {planJunctionTrajectory} from '../src/junction-driver-planner.js';

const rectangle=(road,index,fromX,toX,fromY,toY,turns=[])=>({
  type:'Feature',
  properties:{road,index,direction:'Forward',type:'Driving',
    allowed_turns:turns},
  geometry:{type:'Polygon',coordinates:[[
    [fromX,fromY],[toX,fromY],[toX,toY],
    [fromX,toY],[fromX,fromY]
  ]]}
});
const coords=[[26,44],[26.0025,44],[26.0042,44],[26.0042,43.998]];
const line={type:'LineString',coordinates:coords};
const reference=routeProfile({geometry:line});
const firstTurn=reference.cumulative[1];
const secondTurn=reference.cumulative[2];
const route={type:'Feature',geometry:line,properties:{
  summary:{lengthInMeters:reference.length}
}};
const lanes=[
  // Approach to junction A: two ordinary unmarked eastbound lanes.
  rectangle(10,0,26.00090,26.00240,44.000049,44.000078),
  rectangle(10,1,26.00090,26.00240,44.000017,44.000046),
  // Exit from A, leading to junction B. Same two lane ordinals.
  rectangle(11,0,26.00270,26.00403,44.000049,44.000078),
  rectangle(11,1,26.00270,26.00403,44.000017,44.000046)
];
const roads=[{type:'Feature',properties:{
  type:'intersection',movements:['10 -> 11']
}}];
const planning=planJunctionTrajectory({
  route,instruction:{routeOffsetInMeters:firstTurn,maneuver:'STRAIGHT'},
  reconstructed:lanes,roads,
  next:{offset:secondTurn,
    instruction:{routeOffsetInMeters:secondTurn,maneuver:'TURN_RIGHT'}}
});
assert.equal(planning.status,'provisional');
assert.equal(planning.lookahead,'right',
  'Two-junction analysis sees the next right turn');
assert.equal(planning.selected.approachLane,1,
  'On a straight segment prefer the rightmost compatible lane before a right turn');
assert.equal(planning.selected.exitLane,1);
assert.equal(planning.selected.explicit,false,
  'No mapped lane arrows should be distinguished from explicit markings');
assert.ok(planning.path.features[0].geometry.coordinates.length>12);
assert.equal(planning.path.features[0].properties.verified,false);
const noNext=planJunctionTrajectory({
  route,instruction:{routeOffsetInMeters:firstTurn,maneuver:'STRAIGHT'},
  reconstructed:lanes,roads
});
assert.equal(noNext.status,'provisional');
assert.equal(noNext.selected.approachLane,0,
  'Without a next maneuver the chosen lane should remain stable');

// A contrary mapped arrow must exclude a lane from the provisional planner.
const marked=lanes.map((l,i)=>i===0
  ? {...l,properties:{...l.properties,allowed_turns:['left']}}:l);
const refused=planJunctionTrajectory({
  route,instruction:{routeOffsetInMeters:firstTurn,maneuver:'STRAIGHT'},
  reconstructed:marked,roads,next:{
    offset:secondTurn,instruction:{maneuver:'TURN_RIGHT'}
  }
});
assert.equal(refused.status,'provisional');
assert.equal(refused.selected.approachLane,1,
  'Do not use a mapped left-only lane for continuing straight');
assert.equal(planJunctionTrajectory({
  route,instruction:{routeOffsetInMeters:firstTurn,maneuver:'STRAIGHT'},
  reconstructed:lanes.slice(0,2),roads
}).status,'unavailable','Without an exit lane, do not invent a line');
assert.equal(planJunctionTrajectory({
  route,instruction:{routeOffsetInMeters:firstTurn,maneuver:'ROUNDABOUT'},
  reconstructed:lanes,roads
}).status,'unavailable','Unrecognized maneuvers must fall back');
console.log('Glide driver-lookahead lane trajectory checks passed.');
