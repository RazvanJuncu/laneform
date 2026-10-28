import assert from 'node:assert/strict';
import {cruiseFromMappedLanes,cruiseFromRouteAlignment} from '../src/lane-cruise.js';
const lane=(index,turns,{road=41,direction='Forward'}={})=>({
  type:'Feature',
  properties:{type:'Driving',road,index,direction,allowed_turns:turns},
  geometry:{type:'Polygon',coordinates:[[
    [26,44],[26.0001,44],[26.0001,44.0001],
    [26,44.0001],[26,44]
  ]]}
});
const section=(offset=260,road=41,n=3)=>({
  offset,kind:'through',
  corridor:{status:'provisional',
    recommendation:{source:'glide',status:'inferred',
      laneCount:n,selected:[1],road,direction:'Forward'}}
});
const roads=[
  lane(0,['left']),lane(1,['through']),lane(2,['through','right'])
];
const args={laneFeatures:roads,throughGuidance:[section()],progress:70};
const selected=cruiseFromMappedLanes(args);
assert.deepEqual(selected.selected,[1,2],
  'Cruise should illuminate both mapped through-capable lanes, never the left-turn-only lane');
assert.deepEqual(selected.turnOnly,[0]);
assert.deepEqual(selected.allowedThrough,[1,2]);
assert.equal(selected.distanceToJunction,190);
assert.equal(selected.status,'inferred');
assert.equal(cruiseFromMappedLanes({
  ...args,laneFeatures:[lane(0,[]),lane(1,[]),lane(2,[])]
}),null,'Unknown OSM markings must never become lane guidance');
assert.equal(cruiseFromMappedLanes({
  ...args,laneFeatures:roads.map(x=>({
    ...x,properties:{...x.properties,road:87}
  }))
}),null,'Do not use a different road for cruise selection');
assert.equal(cruiseFromMappedLanes({
  ...args,laneFeatures:roads.map(x=>({
    ...x,properties:{...x.properties,direction:'Backward'}
  }))
}),null,'Do not take lane markings from the oncoming carriageway');
assert.equal(cruiseFromMappedLanes({
  ...args,laneFeatures:[lane(0,['through']),lane(1,['through'])],
  throughGuidance:[section(260,41,2)]
}),null,'No turn-only lane means no reason to steer the driver');
assert.equal(cruiseFromMappedLanes({...args,progress:250}),null,
  'No cue after the driver already entered the junction');
assert.equal(cruiseFromMappedLanes({
  ...args,laneFeatures:[...roads,lane(1,['right'])]
}),null,'Conflicting overlapping OSM polygons should suppress cruise');
assert.equal(cruiseFromMappedLanes({
  ...args,laneFeatures:[lane(0,['left']),lane(1,['through'])]
}),null,'Incomplete lane-group metadata must not imply missing lane behavior');
const right=cruiseFromMappedLanes({
  ...args,nextTurnOffset:490,nextTurnDirection:'right'
});
assert.deepEqual(right.selected,[2],
  'Anticipate following RIGHT turn when both through lanes are permitted');
const left=cruiseFromMappedLanes({
  ...args,nextTurnOffset:490,nextTurnDirection:'left'
});
assert.deepEqual(left.selected,[1],
  'Remain in leftmost through-capable lane for next LEFT turn');

// When OSM omits turn-only markings, an already rendered multi-lane
// APPROACH can still provide an explicitly provisional lane-alignment hint.
const alignment=cruiseFromRouteAlignment({
  corridor:{status:'provisional',recommendation:{
    source:'glide',status:'inferred',laneCount:3,selected:[0],
    road:12, direction:'Forward'
  },diagnostics:{approachSamples:8},
  path:{features:[{type:'Feature'}]}},
  distanceToManeuver:315,turnDirection:'left'
});
assert.equal(alignment.mode,'alignment');
assert.deepEqual(alignment.selected,[0]);
assert.deepEqual(alignment.turnOnly,[],
  'Geometry-only Cruise must not claim turn-only restrictions');
assert.match(alignment.reason,/unknown/);
assert.equal(cruiseFromRouteAlignment({
  corridor:{status:'provisional',recommendation:{
    source:'glide',status:'inferred',laneCount:1,selected:[0]},
    diagnostics:{approachSamples:8},path:{features:[{}]}},
  distanceToManeuver:315,turnDirection:'left'
}),null,'Single-lane roads have no meaningful Cruise lane choice');
assert.equal(cruiseFromRouteAlignment({
  corridor:{status:'provisional',recommendation:{
    source:'glide',status:'inferred',laneCount:3,selected:[0]},
    diagnostics:{approachSamples:1},path:{features:[{}]}},
  distanceToManeuver:315,turnDirection:'left'
}),null,'Never recommend from a solitary, unstable lane sample');

console.log('Glide explicit turn-only cruise lane guidance tests passed.');
