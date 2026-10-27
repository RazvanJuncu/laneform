import assert from 'node:assert/strict';
import {routeProfile} from '../src/osm-lane-geometry.js';
import {buildLaneCorridor} from '../src/junction-road-corridor.js';

const polygon=(road,index,direction,left,right,bottom,top,turns=[])=>({
  type:'Feature',properties:{type:'Driving',road,index,direction,
    allowed_turns:turns},
  geometry:{type:'Polygon',coordinates:[[
    [left,bottom],[right,bottom],[right,top],
    [left,top],[left,bottom]
  ]]}
});
const line={type:'LineString',coordinates:[
  [26,44],[26,44.00077],[26,44.0015]
]};
const profile=routeProfile({geometry:line});
const route={type:'Feature',geometry:line,properties:{
  summary:{lengthInMeters:profile.length}
}};
const lanes=[
  polygon(7,0,'Forward',26.000012,26.000054,
    44.00002,44.00069),
  polygon(7,1,'Backward',25.999945,25.999987,
    44.00002,44.00069),
  polygon(8,0,'Forward',26.000012,26.000054,
    44.00085,44.00148),
  polygon(8,1,'Backward',25.999945,25.999987,
    44.00085,44.00148)
];
const result=buildLaneCorridor({
  route,offset:profile.length/2,lanes,radius:100
});
assert.equal(result.status,'provisional',
  'Build lane-aware line on a simple T-junction without an explicit turn');
assert.ok(result.coverage.length>=1);
assert.ok(result.path.features.length>=1);
assert.ok(result.samples>7);
assert.ok(result.path.features.every(f=>
  f.geometry.coordinates.every(p=>p[0]>26.000010)),
'Prefer the northbound driving lane, not the road center or oncoming lane');
assert.ok(result.path.features.some(f=>
  f.geometry.coordinates.some(p=>p[1]<44.00069) &&
  f.geometry.coordinates.some(p=>p[1]>44.00085)),
  'Bridge a short gap at the intersection with a smooth trajectory');
assert.ok(result.coverage.every(v=>
  Number.isFinite(v[0])&&Number.isFinite(v[1])&&v[0]<v[1]));
const leftRestricted=[
  {...lanes[0],properties:{...lanes[0].properties,allowed_turns:['left']}},
  lanes[1],
  {...lanes[2],properties:{...lanes[2].properties,allowed_turns:['left']}},
  lanes[3]
];
const contrary=buildLaneCorridor({
  route,offset:profile.length/2,lanes:leftRestricted,
  instruction:{routeOffsetInMeters:profile.length/2,maneuver:'STRAIGHT'},
  radius:100
});
assert.ok(contrary.path.features.every(f=>
  f.geometry.coordinates.every(p=>p[0]>26)),
  'Never direct the vehicle to oncoming lanes when forward arrows disagree');
assert.equal(buildLaneCorridor({route,offset:60,lanes:[]}).status,
  'unavailable','No driving-lane polygons: route-centerline fallback');
console.log('Glide geometry-first lane-corridor regression tests passed.');
