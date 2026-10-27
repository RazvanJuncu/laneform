import assert from 'node:assert/strict';
import {nextRollingStation,rollingAreaPoint,
  ROLLING_STEP_METERS,ROLLING_AREA_RADIUS_METERS}
  from '../src/cruise-rolling-window.js';
import {routeProfile,positionAtDistance}
  from '../src/osm-lane-geometry.js';
assert.equal(ROLLING_STEP_METERS,300);
assert.equal(ROLLING_AREA_RADIUS_METERS,190);
assert.equal(nextRollingStation(0,2200),300);
assert.equal(nextRollingStation(100,2200),300);
assert.equal(nextRollingStation(170,2200),600,
  'Advance to next cached lookahead window only after sufficient travel');
assert.equal(nextRollingStation(220,2200),600);
assert.equal(nextRollingStation(2090,2200),null,
  'No pointless OSM request beyond the destination');
const lat=44,lon=26;
const route={geometry:{type:'LineString',coordinates:[
  [lon,lat],[lon,lat+.012]
]},properties:{summary:{lengthInMeters:1330}}};
const first=rollingAreaPoint(route,300,routeProfile,positionAtDistance);
assert.ok(first[1]>lat+.002 && first[1]<lat+.004);
assert.equal(rollingAreaPoint(route,NaN,routeProfile,positionAtDistance),null);
console.log('Glide bounded rolling route sampler station tests passed.');
