import assert from 'node:assert/strict';
import {routeProfile} from '../src/osm-lane-geometry.js';
import {buildLaneCorridor} from '../src/junction-road-corridor.js';
import {twoStageLaneGuidance} from '../src/lane-hud-model.js';

const north={type:'LineString',coordinates:[
  [26,44],[26,44.00145],[26,44.0018]
]};
const profile=routeProfile({geometry:north});
const route={type:'Feature',geometry:north,properties:{
  summary:{lengthInMeters:profile.length}
}};
const polygon=(index,left,right,south,north)=>({
  type:'Feature',properties:{
    type:'Driving',road:12,index,direction:'Forward',allowed_turns:[]
  },geometry:{type:'Polygon',coordinates:[[
    [left,south],[right,south],[right,north],[left,north],
    [left,south]
  ]]}
});
const maneuver=profile.cumulative[1];
const output=buildLaneCorridor({
  route,offset:maneuver,radius:120,
  lanes:[
    polygon(0,26.000012,26.000042,44.00015,44.00178),
    // A dedicated extra lane only joins the approach ~25m before junction.
    polygon(1,26.000044,26.000074,44.00120,44.00178)
  ]
});
assert.equal(output.status,'provisional');
assert.equal(output.recommendation?.laneCount,1,
  'Upstream sample must report the actual single lane');
assert.equal(output.nearApproachRecommendation?.laneCount,2,
  'The lane that appears near the intersection must not be lost');
assert.deepEqual(output.nearApproachRecommendation?.selected,[0],
  'New two-lane selection is taken from displayed corridor samples');
const early=twoStageLaneGuidance(output.recommendation,null,245,{
  nearApproach:output.nearApproachRecommendation
});
assert.equal(early,null,
  'Do not present one pointless square before a useful added lane appears');
const near=twoStageLaneGuidance(output.recommendation,null,131,{
  nearApproach:output.nearApproachRecommendation,
  selectedTurnSide:'left'
});
assert.equal(near.laneCount,2,
  'Final approach HUD must show both mapped lanes once near junction');
assert.equal(near.widensFrom,1);
assert.deepEqual(near.addedLaneIndices,[0],
  'New left-turn lane must carry the plus on the left');
assert.deepEqual(near.selected,[0]);
assert.equal(near.exit,null);
console.log('Glide late widening lane-count and staged HUD tests passed.');
