import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../src/junction-detail.js',import.meta.url),'utf8');
const a=src.indexOf('  function reuseRollingForJunction(');
const b=src.indexOf('\n  function updateButton(){',a);
assert.ok(a>=0&&b>a,'Junction must consult cached Cruise OSM data');
const body=src.slice(a,b);
let classified=0,updated=0,changed=0,pending=0,complete=true;
const target={position:[26,44],offset:4389};
const state={route:{properties:{summary:{lengthInMeters:15000}}},
  target,cache:new Map(),rollingCache:new Map([[4200,{data:{lanes:{features:[]}}}]]),
  rejectedAreaReuses:new Set(),reusedJunctions:0,lastReusedStation:null,
  reason:'cooldown'};
const callback=new Function('state','junctionCacheKey','reusableAreaCandidates',
 'routeProfile','positionAtDistance','classifyTarget',
 'reconstructedJunctionCovered','clearPending','updateAppearance',
 'onGuidanceChange','MAX_CACHE','console',body+
 '\nreturn reuseRollingForJunction;');
const fn=callback(state,p=>p.join(','),()=>[
  {station:4200,value:state.rollingCache.get(4200),distance:189}
],()=>{},()=>{},(_,cached)=>{
  classified++;
  cached.corridor={status:'provisional',laneFrames:[
    {at:4305},{at:4310},{at:4420},{at:4425}
  ]};
},(corridor,at)=>complete&&corridor.laneFrames.some(f=>f.at<at)&&
 corridor.laneFrames.some(f=>f.at>at),
()=>{pending++},()=>{updated++},()=>{changed++},5,
{info:()=>{}});
assert.equal(fn(target),true,
 'Valid existing Cruise area bypasses the pending network cooldown');
assert.equal(state.cache.size,1);
assert.equal(state.reason,'reused-rolling');
assert.equal(state.reusedJunctions,1);
assert.equal(state.lastReusedStation,4200);
assert.equal(classified,1);
assert.equal(pending,1);
assert.equal(updated,1);
assert.equal(changed,1);
assert.equal(fn(target),true);
assert.equal(classified,1,'Already reused area is never reclassified');
state.cache.clear();state.rejectedAreaReuses.clear();complete=false;
assert.equal(fn(target),false,'An area without enough lane coverage is rejected');
assert.equal(fn(target),false);
assert.equal(classified,2,
 'Rejected candidate is not reclassified every animation frame');
assert.equal(state.cache.size,0);
console.log('Glide Junction cache reuse bypasses cooldown without false geometry accepted.');
