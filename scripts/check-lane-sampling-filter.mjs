import assert from 'node:assert/strict';
import {suppressLaneSamplingSpikes} from '../src/lane-sampling-filter.js';
import {routeProfile,positionAtDistance}
  from '../src/osm-lane-geometry.js';

const lat=44,lon=26,cos=Math.cos(lat*Math.PI/180);
const point=(x,y)=>[lon+x/(111320*cos),lat+y/110540];
const road={geometry:{type:'LineString',coordinates:[
  point(0,0),point(100,0)
]}};
const profile=routeProfile(road);
const samples=Array.from({length:19},(_,i)=>{
  const x=i*5;
  const lateral=(i===8||i===9)?6:2;
  return {d:x,point:point(x,lateral),road:7,direction:'Forward',
    laneCount:1,laneOrdinal:0,index:0,hudEligible:true};
});
const actual=suppressLaneSamplingSpikes(samples,{
  profile,positionAtDistance
});
const lateral=p=>(p[1]-lat)*110540;
assert.equal(actual.samples.length,samples.length);
assert.ok(actual.diagnostics.corrected>=2,
  'Both points of a triangular polygon mismatch should be corrected');
for(const index of [8,9]){
  assert.ok(Math.abs(lateral(actual.samples[index].point)-2)<.25,
    'Brief lateral deflection should be returned to the true lane');
  assert.equal(actual.samples[index].spikeCorrected,true);
}
assert.equal(actual.samples[3],samples[3],
  'Stable segments should retain their exact original mapped positions');
const sustained=samples.map((s,i)=>({
  ...s,point:point(i*5,i>=8?6:2)
}));
const kept=suppressLaneSamplingSpikes(sustained,{
  profile,positionAtDistance
});
assert.equal(kept.samples[15].point[1],sustained[15].point[1],
  'A persistent lane relocation must not be erased as a glitch');
const bendRoute={geometry:{type:'LineString',coordinates:[
  point(0,0),point(50,0),point(50,50)
]}};
const bendProfile=routeProfile(bendRoute);
const bendSamples=Array.from({length:19},(_,i)=>{
  const d=i*5;
  const p=positionAtDistance(bendProfile,d);
  return {d,point:p,road:d<=50?1:2,index:0,direction:'Forward'};
});
const bent=suppressLaneSamplingSpikes(bendSamples,{
  profile:bendProfile,positionAtDistance
});
assert.ok(bent.samples.every((p,i)=>p?.point===bendSamples[i].point),
  'A true 90-degree road bend must not be straightened');
console.log('Glide triangular lane sampling spike filter tests passed.');
