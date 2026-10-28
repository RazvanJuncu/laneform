import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isJunctionPhase} from '../src/lane-junction-policy.js';
const source=readFileSync(new URL('../src/junction-detail.js',import.meta.url),'utf8');
const a=source.indexOf('  function activeGuidance(){');
const b=source.indexOf('  function cruiseHint(){',a);
const s=source.indexOf('  function getSuggestedLanes(){');
const end=source.indexOf('  function begin(route){',s);
assert.ok(a>=0&&b>a&&s>=0&&end>s);
assert.ok(!source.slice(a,b).includes('cachedThroughCrossings()'),
 'A straight OSM crossing must not become a second turn-preview phase');
const state={
 route:{properties:{guidance:{instructions:[]}}},
 target:{index:0,offset:5600},
 progress:200,rollingCache:new Map()
};
const entry=()=>({corridor:{status:'provisional',
 recommendation:{source:'glide',status:'inferred',
 laneCount:3,selected:[1]},
 laneFrames:[]},
 throughGuidance:[{offset:280,kind:'through'}]});
const model=new Function('state','entry','isJunctionPhase',
 'expectedLaneTurn','stableMappedLaneGroup','twoStageLaneGuidance',
 source.slice(a,b)+source.slice(s,end)+
 '\nreturn {activeGuidance,junctionPhase,getSuggestedLanes};')(
 state,entry,isJunctionPhase,()=>null,()=>null,()=>null);
assert.equal(model.junctionPhase(),false,
 'Straight crossing at 280m cannot suppress Cruise when turn is 5.4km away');
assert.equal(model.getSuggestedLanes(),null,
 'No pointless approach/after-junction rows for continuing straight');
assert.equal(model.activeGuidance().kind,'maneuver',
 'Keep target turn separate from OSM through crossing');
state.progress=5350;
assert.equal(model.junctionPhase(),true,
 'Only the actual close routed turn activates intersection phase');
console.log('Glide Cruise remains active across straight crossings while far-off turn stays in nav bar.');
