import assert from 'node:assert/strict';
import {routeProfile} from '../src/osm-lane-geometry.js';
import {sampleImportantThroughJunctions}
  from '../src/junction-straight-sampling.js';
const route={
  type:'Feature',
  geometry:{type:'LineString',coordinates:[
    [26,44],[26.0015,44],[26.0035,44]
  ]},
  properties:{summary:{lengthInMeters:280}}
};
const profile=routeProfile(route);
const at=profile.length*.46;
const near=[26+(26.0035*.46),44];
const junction=(coords,moves=['1 -> 2','1 -> 3'])=>({
  type:'Feature',properties:{type:'intersection',movements:moves},
  geometry:{type:'Point',coordinates:coords}
});
const site=[26.00161,44];
const expected=at/profile.length*280;
const candidates=sampleImportantThroughJunctions({
  route,roads:[junction(site)],centerOffset:240,excludeOffsets:[240]
});
assert.equal(candidates.length,1);
assert.equal(candidates[0].kind,'through');
assert.equal(candidates[0].arms,3);
assert.ok(candidates[0].offset>90&&candidates[0].offset<160);
assert.equal(sampleImportantThroughJunctions({
  route,roads:[junction(site)],centerOffset:240,excludeOffsets:[130]
}).length,0,'Explicit routed maneuver already covers this junction');
assert.equal(sampleImportantThroughJunctions({
  route,roads:[junction(site,['1 -> 2'])],centerOffset:240
}).length,0,'Two-arm roads are not significant straight junctions');
assert.equal(sampleImportantThroughJunctions({
  route,roads:[junction([26.00161,44.0004])],centerOffset:240
}).length,0,'Junctions far from route must not create lane hints');
assert.equal(sampleImportantThroughJunctions({
  route,roads:[junction(site)],centerOffset:500
}).length,0,'Do not infer a junction outside the cached corridor');
const turnRoute={
  type:'Feature',geometry:{type:'LineString',coordinates:[
    [26,44],[26.0016,44],[26.0016,44.0022]
  ]},properties:{summary:{lengthInMeters:300}}
};
assert.equal(sampleImportantThroughJunctions({
  route:turnRoute,roads:[junction(site)],
  centerOffset:220,excludeOffsets:[]
}).length,0,'Sharp turns are not straight-through crossings');
console.log('Glide cached-OSM significant through-junction sampling checks passed.');
