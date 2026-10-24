// Glide global anticipatory lane events.
// A route is the anchor, not the existence of a TomTom turn instruction.
// This also catches mapped turn-only lanes where the planned route continues
// straight and no turn-by-turn instruction exists.
//
// Data: OSM turn markings, NOT verified physical lane connectivity.
// Deliberately conservative: unmatched, conditional, ambiguous, or reversed
// road markings produce no lane advice. No network or DOM dependencies.
import { routeProfile, positionAtDistance, normalizeOsmTurnLanes } from './osm-lane-geometry.js';

const RAD=Math.PI/180;
const EARTH=6371000;
const VALID_HIGHWAYS=new Set([
  'motorway','trunk','primary','secondary','tertiary','unclassified',
  'residential','living_street','motorway_link','trunk_link','primary_link',
  'secondary_link','tertiary_link'
]);
function longitudeDelta(a,b){return ((b-a+540)%360)-180;}
function meters(a,b){
  const la=(b[1]-a[1])*RAD;
  const lo=longitudeDelta(a[0],b[0])*RAD;
  const q=Math.sin(la/2)**2+Math.cos(a[1]*RAD)*Math.cos(b[1]*RAD)*Math.sin(lo/2)**2;
  return EARTH*2*Math.asin(Math.min(1,Math.sqrt(q)));
}
function heading(a,b){
  const mid=(a[1]+b[1])/2*RAD;
  return Math.atan2(longitudeDelta(a[0],b[0])*Math.cos(mid),b[1]-a[1])*180/Math.PI;
}
function angularDifference(a,b){return ((b-a+540)%360)-180;}
function pointToSegment(p,a,b){
  const scaleX=Math.cos(p[1]*RAD)*111320,scaleY=110540;
  const dx=longitudeDelta(a[0],b[0])*scaleX,dy=(b[1]-a[1])*scaleY;
  const px=longitudeDelta(a[0],p[0])*scaleX,py=(p[1]-a[1])*scaleY;
  const lengthSq=dx*dx+dy*dy;
  const t=lengthSq>0?Math.max(0,Math.min(1,(px*dx+py*dy)/lengthSq)):0;
  return {distance:Math.hypot(px-t*dx,py-t*dy),fraction:t};
}
function findOnRoute(profile,location){
  let best=null;
  // Only the leading OSM scan window has been downloaded. Do not scan
  // thousands of irrelevant kilometres for every tagged local road.
  for(let i=1;i<profile.points.length;i++){
    if(profile.cumulative[i-1]>4100)break;
    const a=profile.points[i-1],b=profile.points[i];
    if(meters(a,b)<1)continue;
    const found=pointToSegment(location,a,b);
    if(!best||found.distance<best.distance){
      const length=profile.cumulative[i]-profile.cumulative[i-1];
      best={separation:found.distance,at:profile.cumulative[i-1]+found.fraction*length};
    }
  }
  return best;
}
function roadTags(way,forward){
  const tags=way.tags||{};
  if(tags['turn:lanes:conditional']||tags['turn:lanes:forward:conditional']||
     tags['turn:lanes:backward:conditional']||
     tags['access:conditional']||tags['vehicle:conditional'])return null;
  if(tags.oneway==='-1'&&forward)return null;
  if(['yes','true','1'].includes(tags.oneway)&&!forward)return null;
  if(forward)return tags['turn:lanes:forward'] ||
    (['yes','true','1'].includes(tags.oneway)?tags['turn:lanes']:null);
  return tags['turn:lanes:backward'] ||
    (tags.oneway==='-1'?tags['turn:lanes']:null);
}
function routeDirection(profile,offset){
  const before=positionAtDistance(profile,offset-37);
  const at=positionAtDistance(profile,offset-8);
  const after=positionAtDistance(profile,offset+38);
  if(!before||!at||!after)return null;
  if(meters(before,at)<10||meters(at,after)<10)return null;
  return {before:heading(before,at),after:heading(at,after)};
}
function movementFromDelta(degrees){
  const absolute=Math.abs(degrees);
  if(absolute<=27)return 'STRAIGHT';
  if(absolute>135)return null; // U-turn connectivity needs a separate graph.
  if(absolute<52)return degrees>0?'SLIGHT_RIGHT':'SLIGHT_LEFT';
  if(absolute<111)return degrees>0?'RIGHT':'LEFT';
  return degrees>0?'SHARP_RIGHT':'SHARP_LEFT';
}
function normalizeWay(way,forward){
  const geometry=way?.geometry;
  if(!Array.isArray(geometry)||geometry.length<2)return null;
  const start=forward?geometry.at(-2):geometry[1];
  const end=forward?geometry.at(-1):geometry[0];
  if(![start?.lat,start?.lon,end?.lat,end?.lon].every(Number.isFinite))return null;
  const a=[start.lon,start.lat],b=[end.lon,end.lat];
  if(meters(a,b)<8)return null;
  return {a,b};
}
export function laneEventsFromCorridor(route,ways){
  if(!Array.isArray(ways)||!route)return [];
  const profile=routeProfile(route);
  if(profile.length<110)return [];
  const total=route?.properties?.summary?.lengthInMeters||profile.length;
  if(!Number.isFinite(total)||total<=0)return [];
  const candidates=[];
  for(const way of ways){
    if(way?.type!=='way'||!Number.isSafeInteger(way.id)||
       !VALID_HIGHWAYS.has(way.tags?.highway) ||
       way.tags.access==='no'||way.tags.motor_vehicle==='no')continue;
    // OSM ways terminate on many kinds of nodes. We accept the marking as
    // a potential approach only if the route passes its terminal point and
    // aligns with the outgoing travel direction on that specific way.
    for(const forward of [true,false]){
      const marking=roadTags(way,forward);
      const lanes=normalizeOsmTurnLanes(marking);
      if(!lanes||lanes.some(lane=>lane.length===0))continue;
      const ends=normalizeWay(way,forward);
      if(!ends)continue;
      const projection=findOnRoute(profile,ends.b);
      if(!projection||projection.separation>8||
         projection.at<60||projection.at>profile.length-45)continue;
      const routeDir=routeDirection(profile,projection.at);
      if(!routeDir)continue;
      const incomingHeading=heading(ends.a,ends.b);
      if(Math.abs(angularDifference(incomingHeading,routeDir.before))>24)continue;
      const requested=movementFromDelta(
        angularDifference(routeDir.before,routeDir.after)
      );
      if(!requested)continue;
      const matching=lanes.map(dirs=>dirs.includes(requested));
      if(!matching.some(Boolean))continue;
      const offset=projection.at/profile.length*total;
      candidates.push({
        index:null,offset,
        guidance:{
          source:'osm',
          status:'mapped-markings-unverified',
          kind:'continuity',
          movement:requested,
          wayId:way.id,
          roadDistanceMeters:projection.separation,
          lanes:lanes.map((directions,i)=>({
            directions,follow:matching[i]?requested:null,
            recommended:matching[i]
          })),
          separators:[]
        }
      });
    }
  }
  candidates.sort((a,b)=>a.offset-b.offset||
    a.guidance.roadDistanceMeters-b.guidance.roadDistanceMeters);
  const records=[];
  for(let i=0;i<candidates.length;){
    const first=candidates[i];
    const cluster=[first];
    let j=i+1;
    while(j<candidates.length &&
      candidates[j].offset-first.offset<=22){
      cluster.push(candidates[j++]);
    }
    // Two different tagged OSM ways near the same approach are not evidence
    // of one unambiguous lane layout. Never choose the prettier one.
    if(new Set(cluster.map(x=>x.guidance.wayId)).size===1)
      records.push(first);
    i=j;
  }
  return records;
}
export function buildLaneTimeline(route,providerRecords=[],osmManeuverRecords=[],corridorRecords=[]){
  const byKey=new Map();
  // More reliable provider maneuver recommendations always win at the
  // same location; corroborating OSM does not upgrade confidence.
  for(const entry of [...corridorRecords,...osmManeuverRecords,...providerRecords]){
    if(!Number.isFinite(entry?.offset)||!entry.guidance?.lanes?.length)continue;
    const key=Math.round(entry.offset/20);
    byKey.set(key,entry);
  }
  return [...byKey.values()].sort((a,b)=>a.offset-b.offset);
}
export function chooseLaneLookahead(timeline,progressMeters,{
  horizonMeters=1100,minimumMeters=14
}={}){
  if(!Array.isArray(timeline))return null;
  for(const record of timeline){
    const d=record.offset-progressMeters;
    if(d<minimumMeters)continue;
    if(d>horizonMeters)break;
    return {...record.guidance,distanceToManeuver:d,at:record.offset};
  }
  return null;
}
