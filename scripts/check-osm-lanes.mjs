import assert from 'node:assert/strict';
import {
  routeProfile,positionAtDistance,approachSamples,maneuverDirection,
  normalizeOsmTurnLanes,matchOsmLaneForManeuver,deriveOsmLaneRecords
} from '../src/osm-lane-geometry.js';
import { routeLaneQuery } from '../src/osm-lane-source.js';

const route={
  geometry:{type:'LineString',coordinates:[[26.000,44],[26.010,44]]},
  properties:{
    summary:{lengthInMeters:800},
    guidance:{instructions:[
      {routeOffsetInMeters:600,maneuver:'TURN_RIGHT',message:'Turn right'},
      {routeOffsetInMeters:800,maneuver:'ARRIVE'}
    ]}
  }
};
const instruction=route.properties.guidance.instructions[0];
const profile=routeProfile(route);
assert.ok(profile.length>750&&profile.length<850);
assert.ok(positionAtDistance(profile,400)[0]>26.004);
assert.ok(approachSamples(route,instruction)?.anchor[0]>26.006);
assert.equal(maneuverDirection(instruction),'RIGHT');
assert.equal(maneuverDirection({maneuver:'ROUNDABOUT_EXIT_RIGHT'}),null,
  'Roundabout connectivity needs separate verified graph data');
assert.deepEqual(normalizeOsmTurnLanes('left|through;right|right'),[
  ['LEFT'],['STRAIGHT','RIGHT'],['RIGHT']
]);
assert.equal(normalizeOsmTurnLanes('||'),null);
assert.equal(normalizeOsmTurnLanes('left'),null);
const way={
  type:'way',id:1234,
  tags:{highway:'primary',oneway:'yes','turn:lanes':'left|through|right'},
  geometry:[{lon:26.005,lat:44},{lon:26.009,lat:44}]
};
const match=matchOsmLaneForManeuver(route,instruction,[way]);
assert.equal(match?.status,'mapped-markings-unverified');
assert.equal(match?.source,'osm');
assert.equal(match?.wayId,1234);
assert.deepEqual(match?.lanes.map(x=>x.recommended),[false,false,true]);

assert.equal(matchOsmLaneForManeuver(route,{...instruction,maneuver:'TURN_SHARP_RIGHT'},[way]),null,
  'Sharp turn must not be substituted by a standard right arrow');
assert.equal(matchOsmLaneForManeuver(route,instruction,[{
  ...way,tags:{highway:'primary',oneway:'yes','turn:lanes':'left|through|left'}
}]),null,'No route-compatible arrow, no guidance');
assert.equal(matchOsmLaneForManeuver(route,instruction,[
  {...way,id:1234},{...way,id:2345}
]),null,'Ambiguous parallel or overlapping OSM ways require withholding advice');

assert.equal(matchOsmLaneForManeuver(route,instruction,[{
  ...way,geometry:[{lon:26.005,lat:44.0003},{lon:26.009,lat:44.0003}]
}]),null,'Far-away carriageway must not be mistaken for the routed road');

assert.equal(matchOsmLaneForManeuver(route,instruction,[{
  ...way,tags:{highway:'primary','turn:lanes':'left|through|right'}
}]),null,'Ambiguous unsuffixed lane tags on two-way roads must be ignored');

const backwardRoute={
  geometry:{type:'LineString',coordinates:[[26.01,44],[26,44]]},
  properties:{summary:{lengthInMeters:800},guidance:{instructions:[
    {routeOffsetInMeters:600,maneuver:'TURN_LEFT'}
  ]}}
};
const backwardWay={...way,id:3456,tags:{highway:'primary',
  'turn:lanes:backward':'left|through|right'},
  geometry:[{lon:26.001,lat:44},{lon:26.005,lat:44}]};
assert.deepEqual(matchOsmLaneForManeuver(backwardRoute,
  backwardRoute.properties.guidance.instructions[0],[backwardWay])
  ?.lanes.map(x=>x.recommended),[true,false,false],
  'Backward travel uses backward-tagged lanes in driver-left-to-right order');

assert.equal(deriveOsmLaneRecords(route,[way]).length,1);
assert.equal(deriveOsmLaneRecords(route,[way])[0].index,0);
assert.ok(routeLaneQuery(route).includes('way(around:115,'),
  'Overpass query must be bounded to maneuver approach points');
assert.ok(routeLaneQuery(route).includes('out geom;'));
assert.equal(routeLaneQuery({properties:{guidance:{instructions:[]}}}),null);
console.log('Glide OSM lane alignment, direction and source-validation tests passed.');
