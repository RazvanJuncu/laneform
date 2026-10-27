import assert from 'node:assert/strict';
import {smoothMappedTurn} from '../src/junction-turn-connector.js';

const lat=44,origin=[26,lat];
const local=(x,y)=>[origin[0]+x/(111320*Math.cos(lat*Math.PI/180)),
  origin[1]+y/110540];
const meters=(a,b)=>Math.hypot(
  (a[0]-b[0])*111320*Math.cos(lat*Math.PI/180),
  (a[1]-b[1])*110540
);
const samples=[];
for(let i=0;i<=24;i++){
  const d=i*5;
  let point,road=1,index=0;
  if(d<=45)point=local(d,0);
  else if(d>=75){point=local(60,d-60);road=2;}
  else{
    // A real polygon matcher can jump between nearby arms inside a turn.
    point=local(60+(i%2?7:-6),i%2?-5:7);
    road=i%2?3:4;index=i%2;
  }
  samples.push({d,point,road,index,direction:'Forward',
    laneOrdinal:0,laneCount:2,hudEligible:true});
}
const result=smoothMappedTurn(samples,{
  turnDistance:60,
  routeDistance:(point)=>Math.min(meters(point,local(60,0)),30)
});
assert.equal(result.bridged,true,'Two stable lane arms should connect');
assert.ok(result.gap>25);
const bridge=result.samples.filter(s=>s?.syntheticTurn);
assert.ok(bridge.length>=5,
  'Replace the entire region of overlapping junction polygons');
assert.ok(bridge.every(p=>!p.hudEligible),
  'Synthetic centerline points cannot claim verified HUD lane selection');
const points=result.samples.filter(Boolean).map(s=>s.point);
const steps=points.slice(1).map((p,i)=>meters(p,points[i]));
assert.ok(steps.every(v=>v<11),
  'Smooth connector cannot teleport sideways across the junction');
const end=bridge.at(-1).point;
assert.ok(end[0]>=local(55,-8)[0] && end[0]<=local(77,8)[0],
  'The bridge must remain near the actual intersection');
assert.ok(points.some(p=>meters(p,local(60,12))<5),
  'The bridge should meet the intended exit arm');
const safety=smoothMappedTurn(samples,{
  turnDistance:60,
  routeDistance:()=>250
});
assert.equal(safety.bridged,false,
  'Unsafe curves leaving the intended route must not be drawn');
assert.ok(safety.samples.some(p=>p===null),
  'Suppress ambiguous junction points when a safe connector cannot be found');
assert.equal(smoothMappedTurn(samples,{turnDistance:NaN}).bridged,false);
console.log('Glide mapped junction turn-smoothing and safe fallback tests passed.');
