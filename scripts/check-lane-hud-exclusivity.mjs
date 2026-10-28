import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('function renderNavigationLaneHud(force=false){');
const end=source.indexOf('\nfunction navHud(forceLaneHud=false){',start);
assert.ok(start>=0&&end>start,
  'Centralized exclusive lane HUD renderer must exist');
const draw=source.slice(start,end)+'\nreturn renderNavigationLaneHud;';
const calls=[];
const cruise=next=>calls.push(['cruise',next]);
const lanes=(data,state)=>calls.push(['lanes',data,state]);
let mode='junction',suggestions=null,providerFallback=null;
let detail={guidanceMode:()=>mode,suggestedLanes:()=>suggestions,
  laneState:()=>({status:'loading'}),cruise:()=>({
    source:'glide',kind:'cruise',laneCount:3,selected:[1]
  })};
const render=new Function('junctionDetail','renderCruiseGuidance',
  'renderLaneAssistance','cachedProviderTurnLanes',draw)(
    detail,cruise,lanes,()=>providerFallback);
render(true);
assert.deepEqual(calls.map(x=>x[0]),['cruise','lanes']);
assert.equal(calls[0][1],null,
  'Even with no OSM lane recommendation, Cruise must disappear at junctions');
assert.equal(calls[1][1],null);
assert.equal(calls[1][2].status,'loading');
calls.length=0;
providerFallback={source:'tomtom',status:'provider-recommendation',
  laneCount:3,selected:[1]};
render(true);
assert.equal(calls[1][1],providerFallback,
  'Use cached TomTom guidance while OSM is unavailable');
calls.length=0;
suggestions={source:'glide',status:'inferred',laneCount:2,selected:[0]};
render(true);
assert.equal(calls[0][1],null);
assert.equal(calls[1][1],suggestions,
  'OSM lane guidance should take precedence over TomTom fallback');
calls.length=0;mode='cruise';
render(true);
assert.deepEqual(calls.map(x=>x[0]),['lanes','cruise']);
assert.equal(calls[0][1],null,
  'Square lane suggestions must disappear after an intersection');
assert.equal(calls[1][1].kind,'cruise');
console.log('Glide Cruise/Junction exclusivity checks passed.');
