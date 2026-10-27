import assert from 'node:assert/strict';
import {routeProfile} from '../src/osm-lane-geometry.js';
import {buildLaneCorridor} from '../src/junction-road-corridor.js';
const lat=44,lon=26,cos=Math.cos(lat*Math.PI/180);
const gps=(x,y)=>[lon+x/(111320*cos),lat+y/110540];
const polygon=(road,index,points)=>({
  type:'Feature',properties:{type:'Driving',road,index,
    direction:'Forward',allowed_turns:[]},
  geometry:{type:'Polygon',coordinates:[points.map(p=>gps(...p))]}
});
const route={type:'Feature',geometry:{type:'LineString',coordinates:[
  gps(0,0),gps(85,0),gps(85,110)
]},properties:{summary:{lengthInMeters:195}}};
const lanes=[
  // Approach eastbound lane, then northbound exit lane.
  polygon(10,0,[[0,-4],[69,-4],[69,-1],[0,-1],[0,-4]]),
  polygon(11,0,[[87,19],[91,19],[91,110],[87,110],[87,19]]),
  // Wrong fragments found near a complex junction. They must not dictate
  // the middle of the turn even if temporarily closest to TomTom's route.
  polygon(12,0,[[73,-4],[90,-4],[90,1],[73,1],[73,-4]]),
  polygon(13,0,[[80,0],[86,0],[86,16],[80,16],[80,0]])
];
const profile=routeProfile(route);
const turn=profile.cumulative[1];
const output=buildLaneCorridor({
  route,offset:turn,lanes,radius:120,
  instruction:{maneuver:'TURN_LEFT',routeOffsetInMeters:turn}
});
assert.equal(output.diagnostics.turnConnector,'smooth',
  'The turn should use a dedicated connector, never raw crossing polygon samples');
assert.equal(output.diagnostics.turnConnectorMethod,'compact-corner',
  'An orthogonal reconstructed junction should turn close to its corner');
assert.ok(output.diagnostics.turnRadiusMeters<=9.1,
  'The displayed turn radius should not produce a huge sweeping arc');
assert.equal(output.status,'provisional');
assert.ok(output.path.features.length>0);
assert.equal(output.recommendation?.road,10,
  'First HUD row must use the same real approach-lane road as the trajectory');
assert.equal(output.exitRecommendation?.road,11,
  'Second HUD row must be derived from the actual rendered exit arm');
assert.deepEqual(output.exitRecommendation?.selected,[0],
  'Never copy the incoming ordinal instead of examining the exit lane');
const segment=output.path.features.find(f=>
  f.geometry.coordinates.some(p=>p[0]<gps(65,0)[0])&&
  f.geometry.coordinates.some(p=>p[1]>gps(85,26)[1]));
assert.ok(segment,'Approach and exit should be joined by one smooth feature');
const points=segment.geometry.coordinates;
const xy=p=>[(p[0]-lon)*111320*cos,(p[1]-lat)*110540];
const chord=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const xyPoints=points.map(xy);
assert.ok(xyPoints.slice(1).every((p,i)=>chord(p,xyPoints[i])<12),
  'No 5-metre sample should jump dozens of metres sideways');
const headings=xyPoints.slice(1).map((p,i)=>{
  const d=[p[0]-xyPoints[i][0],p[1]-xyPoints[i][1]],n=Math.hypot(...d);
  return n>0.1?[d[0]/n,d[1]/n]:null;
}).filter(Boolean);
assert.ok(headings.slice(1).every((v,i)=>
  headings[i][0]*v[0]+headings[i][1]*v[1]>.45),
  'No sharp lane-switch kink inside the smoothed intersection');
console.log('Glide full lane-sampler turn with overlapping OSM polygon tests passed.');
