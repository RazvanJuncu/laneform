import assert from 'node:assert/strict';
import { nextManeuverState, isArrivalInstruction, arrivalApproachText }
  from '../src/maneuver-guidance.js';

const arrive={
  maneuver:'ARRIVE_RIGHT',instructionType:'LOCATION_ARRIVAL',
  message:'You have reached your destination. It is on the right.',
  routeOffsetInMeters:5100
};
const turn={maneuver:'TURN_LEFT',message:'Turn left onto Strada Ghidigeni.',
  routeOffsetInMeters:1600};

assert.equal(isArrivalInstruction(arrive),true);
assert.equal(isArrivalInstruction({message:'You have reached your destination on the left'}),true);
assert.equal(isArrivalInstruction(turn),false);

const far=nextManeuverState([arrive],2000,5100);
assert.equal(far.type,'cruise','3.1 km remaining cannot be an arrival instruction');
assert.equal(far.distance,3100);
assert.equal(far.instruction,null);

const turning=nextManeuverState([turn,arrive],950,5100);
assert.equal(turning.type,'turn');
assert.equal(turning.distance,650);
assert.equal(turning.index,0);
assert.equal(turning.instruction,turn);

const afterTurn=nextManeuverState([turn,arrive],2000,5100);
assert.equal(afterTurn.type,'cruise');
assert.equal(afterTurn.distance,3100);

const nearArrival=nextManeuverState([arrive],5050,5100);
assert.equal(nearArrival.type,'approach');
assert.equal(nearArrival.distance,50);
assert.equal(arrivalApproachText(nearArrival.instruction),
  'Destination ahead on the right');

const end=nextManeuverState([arrive],5100,5100);
assert.equal(end.type,'complete');
assert.equal(end.distance,0);

assert.equal(nextManeuverState([],1200,5100).type,'cruise',
  'Routes without instructions must still have sensible guidance');
assert.equal(nextManeuverState([{maneuver:'ARRIVE',
  routeOffsetInMeters:5100}],4000,5100).type,'cruise');
assert.equal(arrivalApproachText({maneuver:'ARRIVE_LEFT'}),
  'Destination ahead on the left');
assert.equal(nextManeuverState([{routeOffsetInMeters:5200,maneuver:'TURN_LEFT'}],
  1000,5100).type,'cruise','Out-of-route instructions must be ignored');

console.log('Glide arrival and maneuver selection regression tests passed.');
