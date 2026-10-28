import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {junctionDownloadEligible} from '../src/junction-logic.js';
import {prioritizeJunctionDownload} from '../src/cruise-rolling-window.js';
const text=readFileSync(new URL('../src/junction-detail.js',import.meta.url),'utf8');
const between=(a,b)=>{
  const begin=text.indexOf(a),end=text.indexOf(b,begin);
  assert.ok(begin>=0&&end>begin,'Expected scheduler boundary '+a);
  return text.slice(begin,end);
};
const junctionSource=between('  function ensureNextPrepared(){',
  '  function clearRollingPending(){');
const rollingSource=between('  function ensureRollingPrepared(){',
  '  function setTarget(next){');
let scheduled=0,delayed=0,cleared=0,fetches=0,allowJunction=false;
const target={position:[26,44],offset:5400};
const state={target,route:{properties:{summary:{lengthInMeters:7000}}},
 progress:0,cache:new Map(),inflight:false,pendingTimer:null,
 lastCall:Date.now()-10000,generation:1,reason:null};
const createJunction=new Function('state','junctionDownloadEligible',
 'junctionCacheKey','reuseRollingForJunction','COOLDOWN_MS',
 'clearPending','setTimeout','Date','downloadJunction',
 'reconstruct','classifyTarget','MAX_CACHE','updateAppearance',
 'onGuidanceChange','ensureRollingPrepared','console','junctionNeedsPriority',
 junctionSource+'\nreturn ensureNextPrepared;');
const junction=createJunction(state,junctionDownloadEligible,
 p=>p.join(','),()=>false,30000,()=>{cleared++},
 (fn,ms)=>{scheduled++;delayed=ms;return scheduled;},Date,
 ()=>{fetches++},()=>{},()=>{},5,()=>{},()=>{},()=>{},console,
 ()=>allowJunction);
junction();
assert.equal(scheduled,0,'5.4km target must not reserve a request timer');
assert.equal(fetches,0);
state.progress=4590; // 810m away; Cruise scan has not completed
junction();
assert.equal(scheduled,0,
 'Cruise must get its nearby OSM slot before a distant junction');
assert.equal(prioritizeJunctionDownload({
 aheadMeters:810,rollingStation:4800,rollingCached:false
}),false);
const clearedBeforeCooldown=cleared;
allowJunction=true; // Cruise scan cached, or junction becomes urgent
junction();
assert.equal(scheduled,1,
 'Junction must schedule cooldown once local coverage is ready');
assert.ok(delayed>=19000&&delayed<=21000);
junction();junction();junction();
assert.equal(scheduled,1,
 'Repeated position frames MUST NOT restart the cooldown timer');
assert.equal(cleared,clearedBeforeCooldown,
  'A queued timer should not be cleared each frame');
state.pendingTimer=null;
state.progress=0;
const rollingState={...state,target,rollingLastStation:null,
 rollingCache:new Map(),inflight:false};
let prioritized=0,rollingCancelled=0;
const createRolling=new Function('state','junctionNeedsPriority',
 'junctionCacheKey','clearRollingPending','ensureNextPrepared',
 rollingSource+'\nreturn ensureRollingPrepared;');
const rolling=createRolling(rollingState,()=>true,
 p=>p.join(','),()=>{rollingCancelled++},()=>{prioritized++});
rollingState.progress=4600;rolling();
assert.equal(prioritized,1,'Imminent junction must take priority over rolling fetch');
assert.equal(rollingCancelled,1);
rollingState.progress=0;
assert.match(rollingSource,/nextRollingStation\(state.progress,total\)/,
 'Cruise must still scan when the next real turn is far away');
assert.match(junctionSource,/if\(state.pendingTimer!==null\)return;/,
 'Cooldown timer must be idempotent while frames advance');
console.log('Glide OSM scheduler prioritization and cooldown timer tests passed.');
