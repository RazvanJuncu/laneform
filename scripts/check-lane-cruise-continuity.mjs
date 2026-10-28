import assert from 'node:assert/strict';
import {cruiseFromLaneContinuity,cruiseFromAvailableLanes}
  from '../src/lane-cruise-continuity.js';
const frames=(counts,{road=3,start=120,step=5}={})=>
  counts.map((offsets,i)=>({at:start+i*step,offsets,
    laneCount:offsets.length,road:
      typeof road==='function'?road(i):road,direction:'Forward',
    selected:0}));
const before=[-4,0,4],after=[-4,0];
const scan=[
  ...frames([before,before,before],{start:105}),
  ...frames([after,after,after],{start:165,road:6})
];
const found=cruiseFromLaneContinuity({laneFrames:scan,progress:35});
assert.equal(found.mode,'continuity');
assert.equal(found.laneCount,3);
assert.deepEqual(found.nonContinuing,[2]);
assert.deepEqual(found.allowedThrough,[0,1]);
assert.deepEqual(found.selected,[1],
  'Stay in centre through lane, not the right-hand departing lane');
const aheadRight=cruiseFromLaneContinuity({
  laneFrames:scan,progress:35,
  nextTurnOffset:295,nextTurnDirection:'right'
});
assert.deepEqual(aheadRight.selected,[1],
  'Pick the rightmost of the lanes that actually continue');
const reverse=[
  ...frames([[-4,0,4],[-4,0,4],[-4,0,4]],{start:105}),
  ...frames([[0,4],[0,4],[0,4]],{start:165})
];
const leftExit=cruiseFromLaneContinuity({laneFrames:reverse,progress:35});
assert.deepEqual(leftExit.nonContinuing,[0]);
assert.deepEqual(leftExit.selected,[1]);
assert.equal(cruiseFromLaneContinuity({
  laneFrames:frames([
    [-4,0],[-4,0],[-4,0],[-4,0,4],[-4,0,4],[-4,0,4]
  ]),progress:40
}),null,'Simply adding a lane is not proof it must be avoided');
assert.equal(cruiseFromLaneContinuity({
  laneFrames:frames([before,before,after]),progress:40
}),null,'A single post-split sample is too fragile');
assert.equal(cruiseFromLaneContinuity({
  laneFrames:frames([before,before,before,[-4,4],[-4,4]],{
    start:130
  }),progress:40
}),null,'Missing centre lane is ambiguous, not a valid exit');
assert.equal(cruiseFromLaneContinuity({
  laneFrames:frames([before,before,before,after,after,after],{
    start:120,step:60
  }),progress:50
}),null,'Do not join lane groups too far apart');
const unknown=scan.map(f=>({...f,direction:'Inferred'}));
assert.equal(cruiseFromLaneContinuity({
  laneFrames:unknown,progress:35
}),null,'Directionless geometry cannot identify safe branch lane');
const twoToThreeToTwo=[
  ...frames([[-4,0],[-4,0],[-4,0]],{start:55,road:2}),
  ...frames([[-4,0,4],[-4,0,4],[-4,0,4]],{start:130,road:3}),
  ...frames([[-4,0],[-4,0],[-4,0]],{start:210,road:4})
];
const beforeWidening=cruiseFromLaneContinuity({
  laneFrames:twoToThreeToTwo,progress:15
});
assert.equal(beforeWidening?.laneCount,2,
  'Do not display future 3-lane width where road currently has two lanes');
assert.equal(beforeWidening?.upcomingLaneCount,3);
assert.deepEqual(beforeWidening.selected,[1]);
assert.deepEqual(beforeWidening.nonContinuing,[]);
const afterWidening=cruiseFromLaneContinuity({
  laneFrames:twoToThreeToTwo,progress:105
});
assert.equal(afterWidening?.laneCount,3,
  'Reveal three mapped lanes when driver approaches the widened section');
assert.deepEqual(afterWidening?.nonContinuing,[2]);

// Maintain the warning after the widening has been passed; the lane still
// peels off farther ahead and should remain highlighted until that split.
const approachingFork=cruiseFromLaneContinuity({
  laneFrames:twoToThreeToTwo,progress:165
});
assert.equal(approachingFork?.laneCount,3);
assert.deepEqual(approachingFork.nonContinuing,[2]);
assert.ok(approachingFork.distanceToJunction>0);


const becomesTwo=[
  ...frames([[-2],[-2],[-2]],{start:70,road:1}),
  ...frames([[-2,2],[-2,2],[-2,2]],{start:155,road:2})
];
const widthCue=cruiseFromAvailableLanes({
  laneFrames:becomesTwo,progress:90
});
assert.equal(widthCue.mode,'available');
assert.equal(widthCue.laneCount,2);
assert.deepEqual(widthCue.selected,[1],
  'Without stronger evidence Cruise gives a clearly labeled right-hand driving heuristic');
assert.equal(widthCue.confidence,'heuristic');
assert.equal(widthCue.timing,'upcoming',
  'Do not imply the additional lane is already beneath the vehicle');
assert.match(widthCue.reason,/Unverified/);
const prepareLeft=cruiseFromAvailableLanes({
  laneFrames:becomesTwo,progress:90,
  nextTurnOffset:500,nextTurnDirection:'left'
});
assert.deepEqual(prepareLeft.selected,[0],
  'Prepare left ahead of a left maneuver when only stable geometry exists');
assert.equal(prepareLeft.preferredSide,'left');
const currentlyMulti=cruiseFromAvailableLanes({
  laneFrames:frames([[-3,1,5],[-3,1,5],[-3,1,5]],{start:86}),
  progress:90
});
assert.equal(currentlyMulti.timing,'current');
assert.deepEqual(currentlyMulti.selected,[2],
  'With no nearer turn or disqualifying data the rightmost lane is the unverified default');
assert.ok(widthCue.distanceToJunction>0);
assert.equal(cruiseFromAvailableLanes({
  laneFrames:frames([[-2],[-2],[-2]]),progress:90
}),null,'One mapped lane is not useful Cruise lane guidance');

console.log('Glide continuous rolling lane topology tests passed.');
