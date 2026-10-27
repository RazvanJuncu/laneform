import assert from 'node:assert/strict';
import {routeProfile} from '../src/osm-lane-geometry.js';
import {buildLaneCorridor} from '../src/junction-road-corridor.js';
import {cruiseFromLaneContinuity}
  from '../src/lane-cruise-continuity.js';
const lat=44,lon=26,c=Math.cos(lat*Math.PI/180);
const ll=(x,y)=>[lon+x/(111320*c),lat+y/110540];
const road={type:'Feature',geometry:{type:'LineString',coordinates:[
  ll(0,0),ll(0,470)
]},properties:{summary:{lengthInMeters:470}}};
const polygon=(road,index,x,y1,y2)=>({
  type:'Feature',properties:{
    type:'Driving',road,index,direction:'Forward',allowed_turns:[]
  },geometry:{type:'Polygon',coordinates:[[
    ll(x-1.45,y1),ll(x+1.45,y1),ll(x+1.45,y2),
    ll(x-1.45,y2),ll(x-1.45,y1)
  ]]}
});
// A 3-lane approach has its rightmost lane peel off while the chosen
// straight route continues as a 2-lane road. The OSM crossing has no
// explicit turn:lanes tags.
const lanes=[
  polygon(3,0,-4,50,190),polygon(3,1,0,50,190),
  polygon(3,2,4,50,190),
  polygon(6,0,-4,212,410),polygon(6,1,0,212,410)
];
const corridor=buildLaneCorridor({
  route:road,offset:230,lanes,radius:185,
  instruction:{maneuver:'STRAIGHT',routeOffsetInMeters:230}
});
assert.equal(corridor.status,'provisional');
assert.ok(corridor.laneFrames.some(f=>f.laneCount===3),
  'Rolling scan must expose all three approach lane centres');
assert.ok(corridor.laneFrames.some(f=>f.laneCount===2),
  'Rolling scan must include the two lanes of the route after the split');
const cruise=cruiseFromLaneContinuity({
  laneFrames:corridor.laneFrames,progress:70
});
assert.equal(cruise?.mode,'continuity',
  'Use route geometry, not TomTom turn messages, to infer the departing lane');
assert.equal(cruise.laneCount,3);
assert.deepEqual(cruise.nonContinuing,[2]);
assert.ok(cruise.selected[0]!==2,
  'Never recommend the mapped lane that leaves the route');
console.log('Glide end-to-end rolling OSM lane-bifurcation test passed.');
