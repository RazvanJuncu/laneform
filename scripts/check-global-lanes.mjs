import assert from 'node:assert/strict';
import {laneEventsFromCorridor,buildLaneTimeline,chooseLaneLookahead}
  from '../src/lane-lookahead.js';
import {routeLaneQuery} from '../src/osm-lane-source.js';

// Synthetic roads in an arbitrary geography (not Bucharest), all units m.
// Driver is traveling EAST through a junction with no TomTom turn instruction.
// Left lane becomes left-only, middle lane continues straight, right turns.
const route={
  geometry:{type:'LineString',coordinates:[[13.000,52.0],[13.012,52.0]]},
  properties:{summary:{lengthInMeters:821},guidance:{instructions:[]}}
};
const tagged={
  type:'way',id:101,
  tags:{highway:'primary',oneway:'yes','turn:lanes':'left|through|right'},
  geometry:[{lon:13.006,lat:52},{lon:13.008,lat:52}]
};
const straight=laneEventsFromCorridor(route,[tagged]);
assert.equal(straight.length,1,'A continuing route must generate lane lookahead without TomTom instructions');
assert.equal(straight[0].guidance.movement,'STRAIGHT');
assert.deepEqual(straight[0].guidance.lanes.map(x=>x.recommended),[false,true,false],
  'Do not recommend a turn-only lane when the route continues straight');
assert.equal(straight[0].guidance.status,'mapped-markings-unverified');
const event=chooseLaneLookahead(straight,straight[0].offset-400);
assert.equal(Math.round(event.distanceToManeuver),400,'The lane cue must appear well before the junction');
assert.equal(chooseLaneLookahead(straight,0,{horizonMeters:50}),null);
assert.equal(chooseLaneLookahead(straight,straight[0].offset+50),null,
  'Passed intersections must not continue displaying lane arrows');

// A left turn into a different road must choose left rather than through.
const leftRoute={
  geometry:{type:'LineString',coordinates:[[13.000,52.0],[13.008,52.0],[13.008,52.003]]},
  properties:{summary:{lengthInMeters:1055},guidance:{instructions:[]}}
};
const turning=laneEventsFromCorridor(leftRoute,[tagged]);
assert.equal(turning.length,1);
assert.equal(turning[0].guidance.movement,'LEFT');
assert.deepEqual(turning[0].guidance.lanes.map(x=>x.recommended),[true,false,false]);

// Reject mapped geometry on another carriageway, conditional signage,
// contradictory duplicates, and a way's reverse direction.
assert.deepEqual(laneEventsFromCorridor(route,[{
  ...tagged,geometry:[{lon:13.006,lat:52.0004},{lon:13.008,lat:52.0004}]
}]),[]);
assert.deepEqual(laneEventsFromCorridor(route,[{
  ...tagged,tags:{...tagged.tags,'turn:lanes:conditional':'left|through|right @ (Mo-Fr)'}
}]),[]);
assert.deepEqual(laneEventsFromCorridor(route,[tagged,{...tagged,id:102}]),[]);
assert.deepEqual(laneEventsFromCorridor(route,[{
  ...tagged,geometry:[...tagged.geometry].reverse()
}]),[]);

// Existing trusted TomTom recommendation must win at the same junction.
const provider=[{index:1,offset:straight[0].offset,
  guidance:{source:'tomtom',status:'provider-recommendation',
    lanes:[{directions:['STRAIGHT'],follow:'STRAIGHT',recommended:true}]}}];
const timeline=buildLaneTimeline(route,provider,[],straight);
assert.equal(timeline.length,1);
assert.equal(timeline[0].guidance.source,'tomtom');
assert.equal(chooseLaneLookahead(timeline,timeline[0].offset-300).source,'tomtom');

// A search corridor exists even with zero instructions. The source is
// location-agnostic and rate-limited instead of fetching on every frame.
const q=routeLaneQuery(route);
assert.ok(q.includes('way(around:125,'));
assert.ok(q.includes('52.000000,13.'));
assert.ok(!q.includes('Bucharest')&&!q.includes('București'));
assert.ok(q.length<5500,'Global corridor request must remain bounded');
console.log('Glide global corridor and anticipatory lane-change tests passed.');
