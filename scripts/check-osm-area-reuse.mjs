import assert from 'node:assert/strict';
import {routeProfile,positionAtDistance} from '../src/osm-lane-geometry.js';
import {reusableAreaCandidates,reconstructedJunctionCovered}
  from '../src/osm-area-reuse.js';
const lat=44,lon=26,c=Math.cos(lat*Math.PI/180);
const geo=(x,y)=>[lon+x/(111320*c),lat+y/110540];
const route={geometry:{type:'LineString',coordinates:[
  geo(0,0),geo(0,1000)
]},properties:{summary:{lengthInMeters:1000}}};
const data={lanes:{features:[{type:'Feature'}]}};
const caches=new Map([
  [300,{data,corridor:{status:'provisional'}}],
  [600,{data,corridor:{status:'provisional'}}],
  [900,{data:null,error:'OSM unavailable'}]
]);
const reused=reusableAreaCandidates({
  route,target:{position:geo(0,485)},rollingCache:caches,
  routeProfile,positionAtDistance
});
assert.equal(reused.length,2);
assert.equal(reused[0].station,600,
  'Nearest cached OSM area should be tried first');
assert.equal(reused[1].station,300,
  'OSM ways can extend slightly beyond their original bbox');
assert.equal(reusableAreaCandidates({
  route,target:{position:geo(0,15)},rollingCache:caches,
  routeProfile,positionAtDistance
}).length,0,'Do not pretend distant cached windows cover a junction');
const covered=(offset=485)=>({
  status:'provisional',laneFrames:[
    {at:offset-90},{at:offset-85},
    {at:offset+55},{at:offset+60}
  ]
});
assert.equal(reconstructedJunctionCovered(covered(),485),true,
  'Require actual stable approach and exit evidence');
assert.equal(reconstructedJunctionCovered({
  status:'provisional',laneFrames:[
    {at:400},{at:405},{at:480},{at:485}
  ]
},485),false,'A clipped OSM area with no exit data is not reusable');
assert.equal(reconstructedJunctionCovered({
  status:'unavailable',laneFrames:covered().laneFrames
},485),false);
assert.equal(reconstructedJunctionCovered({
  status:'provisional',laneFrames:[{at:380},{at:540}]
},485),false,'Reject a lone lane frame on each side');
console.log('Glide OSM Cruise-to-Junction cache reuse evidence tests passed.');
