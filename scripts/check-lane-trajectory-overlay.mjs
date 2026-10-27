import assert from 'node:assert/strict';
import {clipCoordinateLine,visibleLaneTrajectorySegments}
  from '../src/lane-trajectory-overlay.js';

const first=[[26,44],[26,44.001],[26,44.002]];
const second=[[26.001,44],[26.001,44.001],[26.001,44.002]];
const trajectory={
  source:'glide',
  features:[first,second].map(coordinates=>({
    type:'Feature',geometry:{type:'LineString',coordinates}
  })),
  coverage:[[100,300],[400,600]]
};
assert.deepEqual(visibleLaneTrajectorySegments(null,150),[]);
assert.equal(visibleLaneTrajectorySegments(trajectory,0).length,2);
assert.equal(visibleLaneTrajectorySegments(trajectory,100).length,2);
assert.equal(visibleLaneTrajectorySegments(trajectory,200).length,2);
assert.equal(visibleLaneTrajectorySegments(trajectory,301).length,1);
assert.equal(visibleLaneTrajectorySegments(trajectory,601).length,0,
  'Do not draw already traveled lane corridors');
const clipped=visibleLaneTrajectorySegments(trajectory,200)[0];
assert.ok(Math.abs(clipped[0][1]-44.001)<.00005,
  'Trajectory is clipped near the vehicle rather than drawn behind it');
assert.deepEqual(clipped.at(-1),first.at(-1));
assert.deepEqual(clipCoordinateLine(first,0),first);
assert.deepEqual(clipCoordinateLine(first,1),[]);
assert.deepEqual(visibleLaneTrajectorySegments({
  ...trajectory,source:'tomtom'},200),[],
  'Only actual reconstructed Glide trajectories can replace the road centerline');
assert.deepEqual(visibleLaneTrajectorySegments({
  ...trajectory,coverage:[[100,300]]},200),[],
  'Mismatched coverage must never hide a provider route');
assert.deepEqual(visibleLaneTrajectorySegments({
  source:'glide',coverage:[[100,300]],features:[
    {geometry:{type:'LineString',coordinates:[[NaN,0],[25,44]]}}
  ]},200),[],
  'Reject invalid/incomplete projected lane paths');
console.log('Glide single-canvas lane precedence and traveled-segment checks passed.');
