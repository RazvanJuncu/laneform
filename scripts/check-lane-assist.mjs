import assert from 'node:assert/strict';
import {
  normalizeLaneSection, extractRouteLaneGuidance, upcomingLaneGuidance, LANE_ARROWS
} from '../src/lane-assist.js';

assert.equal(normalizeLaneSection(null),null,'No data must not create lanes');
assert.equal(normalizeLaneSection({lanes:[{directions:['RIGHT']},{directions:['STRAIGHT']}]}),null,
  'Unrecommended lanes must not masquerade as advice');
assert.equal(normalizeLaneSection({lanes:[{directions:['RIGHT'],follow:'LEFT'},
  {directions:['STRAIGHT']}]}),null,'Follow direction must match allowed lane direction');

const tomtom = normalizeLaneSection({
  lanes:[
    {directions:['LEFT'],follow:'LEFT'},
    {directions:['STRAIGHT','LEFT'],follow:'LEFT'},
    {directions:['RIGHT']}
  ],
  laneSeparators:['SINGLE_SOLID','SHORT_DASHED','LONG_DASHED','SINGLE_SOLID']
});
assert.equal(tomtom.source,'tomtom');
assert.equal(tomtom.status,'provider-recommendation');
assert.deepEqual(tomtom.lanes.map(x=>x.recommended),[true,true,false]);
assert.deepEqual(tomtom.separators,['SINGLE_SOLID','SHORT_DASHED','LONG_DASHED','SINGLE_SOLID']);
assert.equal(LANE_ARROWS.RIGHT,'↱');

const route={properties:{guidance:{instructions:[
  {routeOffsetInMeters:100},
  {routeOffsetInMeters:620},
  {routeOffsetInMeters:1000}
]}}};
const records=extractRouteLaneGuidance(route,(_route, instruction) =>
  instruction.routeOffsetInMeters===620 ? {
    lanes:[{directions:['LEFT'],follow:'LEFT'},{directions:['RIGHT']}]
  } : undefined
);
assert.equal(records.length,1);
assert.equal(records[0].index,1);
assert.equal(upcomingLaneGuidance(records,route.properties.guidance.instructions[1],200,480,1).lanes.length,2);
assert.equal(upcomingLaneGuidance(records,route.properties.guidance.instructions[1],50,480,1),null,
  'Do not show lanes too early');
assert.equal(upcomingLaneGuidance(records,route.properties.guidance.instructions[1],615,480,1),null,
  'Do not show lanes within the final 12m where instructions may change');
assert.equal(upcomingLaneGuidance(records,route.properties.guidance.instructions[2],700,480,2),null,
  'Do not borrow lane recommendations from a different instruction');
assert.deepEqual(extractRouteLaneGuidance(route,()=>{throw Error('provider unavailable')}),[],
  'Provider helper failure must safely fall back to no guidance');
console.log('Glide lane-assist provider validation, coverage and fallback tests passed.');
