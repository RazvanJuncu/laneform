import assert from 'node:assert/strict';
import {nextRollingStation,rollingAreaPoint,
  ROLLING_STEP_METERS,ROLLING_AREA_RADIUS_METERS,
  prioritizeJunctionDownload}
  from '../src/cruise-rolling-window.js';
import {routeProfile,positionAtDistance}
  from '../src/osm-lane-geometry.js';
assert.equal(prioritizeJunctionDownload({
  aheadMeters:850,rollingStation:300,rollingCached:false
}),false,'Nearby Cruise coverage should be loaded before a distant turn');
assert.equal(prioritizeJunctionDownload({
  aheadMeters:500,rollingStation:600,rollingCached:false
}),true,'Imminent junctions take priority over optional rolling scans');
assert.equal(prioritizeJunctionDownload({
  aheadMeters:840,rollingStation:300,rollingCached:true
}),true,'Once local geometry is cached, prefetch the distant junction');
assert.equal(prioritizeJunctionDownload({
  aheadMeters:840,rollingStation:null,rollingCached:false
}),true,'With no rolling station there is no reason to delay a junction');
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
