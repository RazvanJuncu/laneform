import assert from 'node:assert/strict';
import {routeProfile,positionAtDistance} from '../src/osm-lane-geometry.js';
import {repairReturningLaneDetours} from '../src/lane-return-filter.js';
const lat=44,lon=26,c=Math.cos(lat*Math.PI/180);
const ll=(x,y)=>[lon+x/(111320*c),lat+y/110540];
const run=(coordinates,samples)=>{
  const profile=routeProfile({geometry:{type:'LineString',coordinates}});
  return repairReturningLaneDetours(samples,{profile,positionAtDistance});
};
const road=[ll(0,0),ll(140,0)];
const line=Array.from({length:26},(_,i)=>({
  d:i*5,point:ll(i*5,2),road:3,index:0,
  laneCount:2,hudEligible:true
}));
const clean=run(road,line);
assert.equal(clean.diagnostics.repaired,0);
assert.equal(clean.samples[8],line[8]);
for(const indices of [[8],[8,9],[8,9,10,11]]){
  const zigzag=line.map(x=>({...x,point:[...x.point]}));
  indices.forEach((i,j)=>{
    zigzag[i].point=ll(i*5,5+(j%2));
    zigzag[i].road=44; // Actual wrong crossroad polygons can supply bad IDs
  });
  const result=run(road,zigzag);
  assert.equal(result.diagnostics.repaired,indices.length,
    'Must correct a '+indices.length+'-sample triangular detour');
  for(const i of indices){
    assert.ok(Math.abs((result.samples[i].point[1]-lat)*110540-2)<.2);
    assert.equal(result.samples[i].hudEligible,false,
      'Corrected samples cannot feed the lane quick-check');
  }
}
const drifting=line.map(x=>({...x,point:[...x.point]}));
for(let i=8;i<drifting.length;i++)drifting[i].point=ll(i*5,5);
const genuine=run(road,drifting);
assert.equal(genuine.diagnostics.events,0,
  'A sustained, non-returning lateral shift must not be erased');
const corner=[ll(0,0),ll(60,0),ll(60,65)];
const turnProfile=routeProfile({geometry:{type:'LineString',coordinates:corner}});
const curved=Array.from({length:24},(_,i)=>({
  d:i*5,point:positionAtDistance(turnProfile,i*5),
  road:1,index:0
}));
assert.equal(run(corner,curved).diagnostics.events,0,
  'A genuine corner should never be straightened');
console.log('Glide out-and-back lane-detour repair regression passed.');
