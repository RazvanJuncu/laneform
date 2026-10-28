// Glide: junction-target selection for progressive geometry inspection.
// It is deliberately independent of city, mapping provider and browser state.
// Ordinary TomTom route instructions provide candidates; this does not
// discover every straight-through junction without richer network data.
import {routeProfile,positionAtDistance} from './osm-lane-geometry.js';
import {isArrivalInstruction} from './maneuver-guidance.js';

export function isPreviewManeuver(instruction){
  if(!instruction||isArrivalInstruction(instruction))return false;
  const code=String(instruction.maneuver||'').toUpperCase();
  const type=String(instruction.instructionType||'').toUpperCase();
  const message=String(instruction.message||'').trim().toLowerCase();
  // A straight-through crossing belongs to Cruise's lane-continuity
  // lookahead, NOT an "approach + after junction" maneuver preview.
  if(/STRAIGHT|CONTINUE|DEPART|START|FOLLOW|HEAD/.test(code))return false;
  if(/DEPARTURE|START_OF_ROUTE/.test(type))return false;
  if(/^continue (straight|ahead|on)\b|^go straight\b|^head (straight|north|south|east|west)\b/.test(message))
    return false;
  // True bends, forks, merges and roundabout entries still merit a
  // focused preview; do not depend on turn:lanes tagging for this.
  // Some providers emit generic instruction types/messages at ordinary
  // through crossings. A non-empty field alone does not establish a turn.
  const lateral=value=>
    /(?:^|_)(?:TURN|LEFT|RIGHT|ROUNDABOUT|MERGE|FORK|KEEP|EXIT|RAMP|UTURN|REVERSE)(?:_|$)/.test(value);
  if(lateral(code)||lateral(type))return true;
  return /^(?:turn|bear|keep|merge|take (?:the )?(?:exit|ramp)|enter (?:the )?roundabout|at the roundabout|make a u[- ]turn|exit (?:the )?highway)\b/.test(message);
}
export function junctionDownloadEligible(target,progress,{
  lookaheadMeters=850,clearanceMeters=35
}={}){
  if(!target||!Number.isFinite(progress)||!Number.isFinite(target.offset))
    return false;
  const ahead=target.offset-progress;
  return ahead>=-clearanceMeters&&ahead<=lookaheadMeters;
}
export function buildJunctionTargets(route){
  const summaryMeters=route?.properties?.summary?.lengthInMeters;
  const instructions=route?.properties?.guidance?.instructions;
  if(!Array.isArray(instructions)||!Number.isFinite(summaryMeters)||
      summaryMeters<=0)return [];
  const path=routeProfile(route);
  if(path.length<80)return [];
  const targets=[];
  const ordered=instructions.map((instruction,index)=>({instruction,index}))
    .filter(({instruction})=>
      isPreviewManeuver(instruction) &&
      Number.isFinite(instruction?.routeOffsetInMeters))
    .sort((a,b)=>a.instruction.routeOffsetInMeters-b.instruction.routeOffsetInMeters);

  for(const {instruction,index} of ordered){
    const at=instruction.routeOffsetInMeters;
    if(at<45||at>summaryMeters-25)continue;
    if(targets.length && at-targets.at(-1).offset<45)continue;
    const point=positionAtDistance(path,at/summaryMeters*path.length);
    if(!point||!point.every(Number.isFinite))continue;
    targets.push({
      id:'j'+index+'-'+Math.round(at),
      index,offset:at,position:point,
      description:instruction.message || 'Upcoming junction'
    });
  }
  return targets;
}
export function upcomingJunction(targets,progressMeters,clearanceMeters=35){
  if(!Array.isArray(targets)||!Number.isFinite(progressMeters))return null;
  return targets.find(t=>Number.isFinite(t.offset)&&
    t.offset+clearanceMeters>=progressMeters) || null;
}
export function junctionViewMode({
  target=null,progress=0,loaded=false,dismissedId=null,
  forcedId=null,zoom=15.65,centerDistanceMeters=0
}={}){
  if(!loaded||!target)return 'standard';
  const ahead=target.offset-progress;
  if(ahead < -35 || ahead > 650)return 'standard';
  if(dismissedId===target.id)return 'standard';
  if(forcedId===target.id)return 'detail';
  // Anticipatory automatic zoom only when geometry was prepared.
  if(ahead>=-20 && ahead<=380)return 'detail';
  // The driver can inspect a farther junction by zooming in near it.
  if(zoom>=18.0 && centerDistanceMeters<=350)return 'detail';
  return 'standard';
}
export function junctionCacheKey(point){
  if(!Array.isArray(point)||!point.every(Number.isFinite))
    throw Error('Invalid junction coordinates');
  return point.map(v=>Number(v).toFixed(4)).join(',');
}
