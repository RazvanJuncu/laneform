import assert from 'node:assert/strict';
import {inferOrdinalContinuity,hasRoadLevelMovement}
  from '../src/lane-continuity.js';

const lane=(road,index,direction,allowed_turns=['left'],type='Driving')=>({
  type:'Feature',properties:{
    type,road,index,direction,allowed_turns
  }
});
const movements=[{
  type:'Feature',
  properties:{type:'intersection',movements:['18 -> 41','10 -> 11']}
}];
assert.equal(hasRoadLevelMovement(movements,18,41),true);
assert.equal(hasRoadLevelMovement(movements,41,18),false);
assert.equal(hasRoadLevelMovement([],18,41),false);

const incoming=[lane(18,5,'Forward'),lane(18,6,'Forward')];
const outgoing=[lane(41,0,'Forward',[]),lane(41,1,'Forward',[])];
const kept=inferOrdinalContinuity(incoming,outgoing,{
  maneuver:'left',roadConnectionConfirmed:true,restrictionsClear:true
});
assert.equal(kept.status,'provisional');
assert.equal(kept.confidence,'heuristic');
assert.deepEqual(kept.pairs.map(p=>[p.fromLane,p.toLane]),
 [[5,0],[6,1]],'Leftmost matches leftmost, rightmost matches rightmost');
assert.deepEqual(kept.pairs.map(p=>p.label),['leftmost','rightmost']);
assert.ok(kept.pairs.every(p=>p.status==='ordinal-heuristic-not-verified'));

const backward=inferOrdinalContinuity(
  [lane(18,4,'Backward'),lane(18,2,'Backward')],
  [lane(41,9,'Backward',[]),lane(41,8,'Backward',[])],{
  maneuver:'left',roadConnectionConfirmed:true,restrictionsClear:true
});
assert.deepEqual(backward.pairs.map(p=>[p.fromLane,p.toLane]),
 [[4,9],[2,8]],'Reverse carriageway order for backward-moving traffic');

// Fail closed when the assumption stops being defensible.
assert.equal(inferOrdinalContinuity(incoming,[outgoing[0]],{
  maneuver:'left',roadConnectionConfirmed:true,restrictionsClear:true
}).pairs.length,0,'Lane drops prevent index-preserving paths');
assert.equal(inferOrdinalContinuity(incoming,outgoing,{
  maneuver:'left',roadConnectionConfirmed:false,restrictionsClear:true
}).pairs.length,0,'No proven road-level connection, no lane correspondence');
assert.equal(inferOrdinalContinuity(incoming,outgoing,{
  maneuver:'left',roadConnectionConfirmed:true,restrictionsClear:false
}).pairs.length,0,'Unclear restrictions block correspondence');
assert.equal(inferOrdinalContinuity([
  lane(18,5,'Forward',['right']),lane(18,6,'Forward',['left'])
],outgoing,{
  maneuver:'left',roadConnectionConfirmed:true,restrictionsClear:true
}).pairs.length,0,'Left-turn lane cannot be paired with right-only approach lane');
assert.equal(inferOrdinalContinuity(incoming,[
  outgoing[0],lane(42,1,'Forward',[])
],{
  maneuver:'left',roadConnectionConfirmed:true,restrictionsClear:true
}).pairs.length,0,'Do not pair multiple destination roads');
assert.equal(inferOrdinalContinuity(incoming,[
  lane(41,0,'Forward',[]),lane(41,0,'Forward',[])
],{
  maneuver:'left',roadConnectionConfirmed:true,restrictionsClear:true
}).pairs.length,0,'Reject duplicate lane indices');
assert.equal(inferOrdinalContinuity([
  lane(18,5,'Forward'),lane(18,6,'Backward')
],outgoing,{
  maneuver:'left',roadConnectionConfirmed:true,restrictionsClear:true
}).pairs.length,0,'Reject mixed driving directions');
console.log('Glide leftmost-to-leftmost ordinal lane heuristic safeguards passed.');
