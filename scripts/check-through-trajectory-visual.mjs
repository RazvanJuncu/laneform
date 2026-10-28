import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/junction-detail.js',import.meta.url),'utf8');
const start=source.indexOf('  function visualLaneGuidance(){');
const end=source.indexOf('  function classifyTarget(',start);
assert.ok(start>=0&&end>start,
 'Visible lane-trajectory selection should be independent of HUD');
const state={route:{},progress:200};
const path={features:[{type:'Feature',geometry:{
 type:'LineString',coordinates:[[26,44],[26.001,44]]
}}]};
const coverage=[{start:0,end:350}];
const crossing={kind:'through',offset:300,corridor:{
 status:'provisional',path,coverage
}};
const maneuver={kind:'maneuver',offset:5600,corridor:null};
const fn=new Function('state','activeGuidance','cachedThroughCrossings',
 source.slice(start,end)+'\nreturn {visualLaneGuidance,usableTrajectory};')(
 state,()=>maneuver,()=>[crossing]);
assert.equal(fn.visualLaneGuidance()?.kind,'through',
 'A distant actual turn does not prevent rendering a known straight crossing');
assert.equal(fn.usableTrajectory()?.features,path.features);
assert.equal(fn.usableTrajectory()?.source,'glide');
state.progress=5310; // real turn 290m ahead
assert.equal(fn.visualLaneGuidance()?.kind,'maneuver',
 'The upcoming actual turn takes visual priority at 380m');
assert.equal(fn.usableTrajectory(),null,
 'Do not paint through-crossing geometry over a real upcoming turn');
state.progress=200;
const noCross=new Function('state','activeGuidance','cachedThroughCrossings',
 source.slice(start,end)+'\nreturn usableTrajectory;')(
 state,()=>maneuver,()=>[]);
assert.equal(noCross(),null,
 'Missing OSM geometry must not manufacture a green lane trajectory');
console.log('Glide straight crossing remains drawable without turn-style lane HUD.');
