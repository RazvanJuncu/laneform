import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('function renderNavigationLaneHud(){');
const end=source.indexOf('\nfunction navHud(){',start);
assert.ok(start>=0&&end>start,
  'Centralized exclusive lane HUD renderer must exist');
const draw=source.slice(start,end)+'\nreturn renderNavigationLaneHud;';
const calls=[];
const cruise=next=>calls.push(['cruise',next]);
const lanes=(data,state)=>calls.push(['lanes',data,state]);
let mode='junction',suggestions=null;
let detail={guidanceMode:()=>mode,suggestedLanes:()=>suggestions,
  laneState:()=>({status:'loading'}),cruise:()=>({
    source:'glide',kind:'cruise',laneCount:3,selected:[1]
  })};
const render=new Function('junctionDetail','renderCruiseGuidance',
  'renderLaneAssistance',draw)(detail,cruise,lanes);
render();
assert.deepEqual(calls.map(x=>x[0]),['cruise','lanes']);
assert.equal(calls[0][1],null,
  'Even with no OSM lane recommendation, Cruise must disappear at junctions');
assert.equal(calls[1][1],null);
assert.equal(calls[1][2].status,'loading');
calls.length=0;
suggestions={source:'glide',status:'inferred',laneCount:2,selected:[0]};
render();
assert.equal(calls[0][1],null);
assert.equal(calls[1][1],suggestions);
calls.length=0;mode='cruise';
render();
assert.deepEqual(calls.map(x=>x[0]),['lanes','cruise']);
assert.equal(calls[0][1],null,
  'Square lane suggestions must disappear after an intersection');
assert.equal(calls[1][1].kind,'cruise');
console.log('Glide Cruise/Junction exclusivity checks passed.');
