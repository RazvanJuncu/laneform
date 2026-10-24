// OSM lane markings near the approach to a routed maneuver.
// This module only evaluates existing way geometry and tags. It never makes
// an external request and never claims verified lane-to-lane connectivity.
import { isArrivalInstruction } from './maneuver-guidance.js';

const R = 6371000;
const RAD = Math.PI / 180;
const DIRECTIONS = Object.freeze({
  through:'STRAIGHT',left:'LEFT',right:'RIGHT',
  slight_left:'SLIGHT_LEFT',slight_right:'SLIGHT_RIGHT',
  sharp_left:'SHARP_LEFT',sharp_right:'SHARP_RIGHT',
  reverse:'LEFT_U_TURN'
});

function meters(a,b) {
  const dLat=(b[1]-a[1])*RAD, dLon=(b[0]-a[0])*RAD;
  const q=Math.sin(dLat/2)**2+
    Math.cos(a[1]*RAD)*Math.cos(b[1]*RAD)*Math.sin(dLon/2)**2;
  return R*2*Math.asin(Math.min(1,Math.sqrt(q)));
}
function bearing(a,b) {
  const lat=(a[1]+b[1])/2*RAD;
  return Math.atan2((b[0]-a[0])*Math.cos(lat),b[1]-a[1])*180/Math.PI;
}
function angleDifference(a,b) {
  return Math.abs(((a-b+540)%360)-180);
}
function pointOnSegment(p,a,b) {
  const lat=p[1]*RAD;
  const xscale=Math.cos(lat)*111320, yscale=110540;
  const bx=(b[0]-a[0])*xscale,by=(b[1]-a[1])*yscale;
  const px=(p[0]-a[0])*xscale,py=(p[1]-a[1])*yscale;
  const denominator=bx*bx+by*by;
  const t=denominator?Math.max(0,Math.min(1,(px*bx+py*by)/denominator)):0;
  return Math.hypot(px-t*bx,py-t*by);
}
export function routeProfile(feature) {
  let lines=[];
  if (feature?.geometry?.type==='LineString') lines=[feature.geometry.coordinates];
  if (feature?.geometry?.type==='MultiLineString') lines=feature.geometry.coordinates;
  const points=[];
  for (const line of lines) for(const p of line || []) {
    if(!Array.isArray(p)||p.length<2||!p.slice(0,2).every(Number.isFinite))continue;
    if(!points.length||meters(points[points.length-1],p)>.15)points.push(p.slice(0,2));
  }
  const cumulative=[0];
  for(let i=1;i<points.length;i++)
    cumulative.push(cumulative[i-1]+meters(points[i-1],points[i]));
  return {points,cumulative,length:cumulative.at(-1)||0};
}
export function positionAtDistance(profile,d) {
  if (profile.points.length<2||profile.length<=0) return null;
  const v=Math.max(0,Math.min(profile.length,d));
  let lo=1,hi=profile.cumulative.length-1;
  while(lo<hi){
    const mid=(lo+hi)>>1;
    if(profile.cumulative[mid]<v)lo=mid+1;else hi=mid;
  }
  const a=profile.points[lo-1],b=profile.points[lo];
  const segment=profile.cumulative[lo]-profile.cumulative[lo-1];
  const t=segment>0?(v-profile.cumulative[lo-1])/segment:0;
  return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
}
export function approachSamples(route,instruction) {
  if(!instruction||isArrivalInstruction(instruction))return null;
  const offset=instruction.routeOffsetInMeters;
  const total=route?.properties?.summary?.lengthInMeters;
  if(!Number.isFinite(offset)||!Number.isFinite(total)||total<=0||offset<100)return null;
  const profile=routeProfile(route);
  if(profile.length<=0)return null;
  const scale=profile.length/total;
  const anchor=positionAtDistance(profile,(offset-55)*scale);
  const a=positionAtDistance(profile,(offset-88)*scale);
  const b=positionAtDistance(profile,(offset-27)*scale);
  if(!anchor||!a||!b||meters(a,b)<18)return null;
  return {anchor,heading:bearing(a,b)};
}
export function maneuverDirection(instruction) {
  if(!instruction||isArrivalInstruction(instruction))return null;
  const code=String(instruction.maneuver||'').toUpperCase();
  if(/ROUNDABOUT|KEEP|MERGE|FORK|UTURN|U_TURN|REVERSE/.test(code))return null;
  if(/SLIGHT_LEFT/.test(code))return 'SLIGHT_LEFT';
  if(/SLIGHT_RIGHT/.test(code))return 'SLIGHT_RIGHT';
  if(/SHARP_LEFT/.test(code))return 'SHARP_LEFT';
  if(/SHARP_RIGHT/.test(code))return 'SHARP_RIGHT';
  if(/LEFT/.test(code))return 'LEFT';
  if(/RIGHT/.test(code))return 'RIGHT';
  if(/STRAIGHT|CONTINUE/.test(code))return 'STRAIGHT';
  const msg=String(instruction.message||'').toLowerCase();
  if(/^turn left\b/.test(msg))return 'LEFT';
  if(/^turn right\b/.test(msg))return 'RIGHT';
  if(/^continue (straight|ahead)\b/.test(msg))return 'STRAIGHT';
  return null;
}
export function normalizeOsmTurnLanes(tag) {
  if(typeof tag!=='string')return null;
  const pieces=tag.split('|');
  if(pieces.length<2||pieces.length>9)return null;
  const lanes=pieces.map(piece=>{
    const dirs=piece.split(';').map(x=>DIRECTIONS[x.trim()]).filter(Boolean);
    return [...new Set(dirs)];
  });
  // Unknown or unmarked lanes must not be quietly shown as "straight".
  if(!lanes.some(lane=>lane.length))return null;
  return lanes;
}
function matchingTag(way,travelWithWay) {
  const tags=way.tags||{};
  const oneway=tags.oneway;
  if(tags['turn:lanes:conditional']||tags['turn:lanes:forward:conditional']||
     tags['turn:lanes:backward:conditional'])return null;
  if(oneway==='-1' && travelWithWay)return null;
  if(['yes','true','1'].includes(oneway) && !travelWithWay)return null;
  if(travelWithWay) {
    if(tags['turn:lanes:forward'])return tags['turn:lanes:forward'];
    if(['yes','true','1'].includes(oneway))return tags['turn:lanes'];
    return null;
  }
  if(tags['turn:lanes:backward'])return tags['turn:lanes:backward'];
  if(oneway==='-1')return tags['turn:lanes'];
  return null;
}
function nearestDirectedSegment(way,point,routeHeading) {
  const shape=way.geometry;
  if(!Array.isArray(shape)||shape.length<2)return null;
  let closest=null;
  for(let i=1;i<shape.length;i++) {
    const a=[shape[i-1].lon,shape[i-1].lat],b=[shape[i].lon,shape[i].lat];
    if(!a.concat(b).every(Number.isFinite)||meters(a,b)<2)continue;
    const separation=pointOnSegment(point,a,b);
    const forward=bearing(a,b);
    for (const same of [true,false]) {
      const heading=same?forward:forward+180;
      const deviation=angleDifference(routeHeading,heading);
      if(deviation>22)continue;
      if(!closest||separation<closest.separation)
        closest={separation,deviation,same};
    }
  }
  return closest;
}
// Only routes that closely overlap a tagged OSM way and have a recognizable
// maneuver can receive inferred arrows. Never infer exact exit-lane mapping.
export function matchOsmLaneForManeuver(route,instruction,ways) {
  const samples=approachSamples(route,instruction);
  const desired=maneuverDirection(instruction);
  if(!samples||!desired||!Array.isArray(ways))return null;
  const candidates=[];
  for(const way of ways) {
    if(way?.type!=='way'||!way.tags?.highway ||
       ['footway','cycleway','path','service','pedestrian'].includes(way.tags.highway) ||
       way.tags.access==='no'||way.tags.motor_vehicle==='no')continue;
    const aligned=nearestDirectedSegment(way,samples.anchor,samples.heading);
    if(!aligned||aligned.separation>9)continue;
    const tag=matchingTag(way,aligned.same);
    const lanes=normalizeOsmTurnLanes(tag);
    if(!lanes)continue;
    const matched=lanes.map(dirs=>dirs.includes(desired));
    if(!matched.some(Boolean))continue;
    candidates.push({wayId:way.id,separation:aligned.separation,deviation:aligned.deviation,
      lanes:lanes.map((dirs,i)=>({directions:dirs,
        follow:matched[i]?desired:null,recommended:matched[i]}))});
  }
  candidates.sort((a,b)=>a.separation-b.separation||a.deviation-b.deviation);
  const first=candidates[0];
  if(!first)return null;
  // Nearby parallel ways / both carriageways = road ambiguity, not advice.
  const near=candidates.filter(c=>c.wayId!==first.wayId&&
    c.separation-first.separation<4);
  if(near.length)return null;
  return {
    source:'osm', status:'mapped-markings-unverified',
    wayId:first.wayId,lanes:first.lanes,
    separators:[],roadDistanceMeters:first.separation
  };
}
export function deriveOsmLaneRecords(route,ways) {
  const instructions=route?.properties?.guidance?.instructions;
  if(!Array.isArray(instructions)||!Array.isArray(ways))return [];
  return instructions.flatMap((instruction,index)=>{
    const guidance=matchOsmLaneForManeuver(route,instruction,ways);
    return guidance && Number.isFinite(instruction.routeOffsetInMeters)
      ? [{index,offset:instruction.routeOffsetInMeters,guidance}] : [];
  });
}
