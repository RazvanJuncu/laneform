import assert from 'node:assert/strict';
import {buildJunctionTargets,junctionDownloadEligible,isPreviewManeuver,
  upcomingJunction} from '../src/junction-logic.js';
const line={
 geometry:{type:'LineString',coordinates:[[26,44],[26.11,44]]},
 properties:{summary:{lengthInMeters:9000},
 guidance:{instructions:[
  {maneuver:'DEPART',routeOffsetInMeters:0,message:'Head east'},
  {maneuver:'STRAIGHT',routeOffsetInMeters:180,message:'Continue straight'},
  {maneuver:'CONTINUE',routeOffsetInMeters:460,message:'Continue on the road'},
  {maneuver:'TURN_RIGHT',routeOffsetInMeters:5600,message:'Turn right'},
  {maneuver:'TURN_LEFT',routeOffsetInMeters:8200,message:'Turn left'},
  {maneuver:'ARRIVE',routeOffsetInMeters:9000,
   instructionType:'LOCATION_ARRIVAL'}
 ]}}
};
const targets=buildJunctionTargets(line);
assert.equal(targets.length,2,
 'Straight roads and departure cannot create a fake preview/junction HUD');
assert.equal(targets[0].offset,5600);
assert.equal(targets[1].offset,8200);
assert.equal(isPreviewManeuver({maneuver:'STRAIGHT'}),false);
assert.equal(isPreviewManeuver({maneuver:'CONTINUE'}),false);
assert.equal(isPreviewManeuver({maneuver:'TURN_LEFT'}),true);
assert.equal(isPreviewManeuver({maneuver:'TURN_RIGHT'}),true);
assert.equal(isPreviewManeuver({maneuver:'ENTER_ROUNDABOUT'}),true);
assert.equal(isPreviewManeuver({maneuver:'KEEP_RIGHT',
 message:'Keep right to stay on route'}),true);
assert.equal(upcomingJunction(targets,200).offset,5600,
 'A 5.4km upcoming turn remains a legitimate instruction, but not a preview');
assert.equal(junctionDownloadEligible(targets[0],200),false,
 'Do not consume OSM requests for a turn 5.4 km away');
assert.equal(junctionDownloadEligible(targets[0],4749),false);
assert.equal(junctionDownloadEligible(targets[0],4750),true,
 'First dedicated download is scheduled at 850m pre-turn');
assert.equal(junctionDownloadEligible(targets[0],5590),true);
assert.equal(junctionDownloadEligible(targets[0],5640),false);
assert.equal(junctionDownloadEligible(null,200),false);
console.log('Glide actionable junction targets and request priority checks passed.');
