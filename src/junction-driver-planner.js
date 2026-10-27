// Glide's local, provisional driving-corridor planner.
// Combines osm2streets lane polygons with the already selected TomTom route.
// It recommends a *mapped* lane trajectory, NOT a verified lane connector,
// GPS-detected vehicle lane or a substitute for signs / road markings.
import {candidateApproachLanePaths,candidateExitLanePaths,expectedLaneTurn}
  from './lane-path-candidates.js';
import {hasRoadLevelMovement} from './lane-continuity.js';

const DEG=Math.PI/180;
const empty=()=>({type:'FeatureCollection',features:[]});
const point=p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite);
function xy(a,b){
  const latitude=((a[1]+b[1])/2)*DEG;
  return [(b[0]-a[0])*111320*Math.cos(latitude),(b[1]-a[1])*110540];
}
function distance(a,b){return Math.hypot(...xy(a,b));}
function ordered(features){
  return [...features].sort((a,b)=>
    a.properties.direction==='Backward'
      ? b.properties.index-a.properties.index
      : a.properties.index-b.properties.index);
}
function grouped(features){
  const groups=new Map();
  for(const feature of features||[]){
    const p=feature?.properties||{},coords=feature?.geometry?.coordinates;
    if(!Number.isInteger(p.road)||!Number.isInteger(p.index)||
      !['Forward','Backward'].includes(p.direction)||
      !Array.isArray(coords)||coords.length<4||!coords.every(point))continue;
    const key=p.road+'/'+p.direction;
    if(!groups.has(key))groups.set(key,[]);
    // One continuous physical trace per lane index.
    if(!groups.get(key).some(f=>f.properties.index===p.index))
      groups.get(key).push(feature);
  }
  return [...groups.values()].map(ordered);
}
function lanePoint(feature,incoming){
  const coords=feature.geometry.coordinates;
  return incoming?coords[coords.length-1]:coords[0];
}
function centroid(lanes,incoming){
  const pts=lanes.map(l=>lanePoint(l,incoming));
  return [pts.reduce((s,p)=>s+p[0],0)/pts.length,
    pts.reduce((s,p)=>s+p[1],0)/pts.length];
}
function matchGroups(approaches,exits,roads){
  const pairs=[];
  for(const a of grouped(approaches)){
    for(const b of grouped(exits)){
      const middle=distance(centroid(a,true),centroid(b,false));
      // Crossings across distant or disconnected road arms are not plausible.
      if(middle>95||middle<3)continue;
      const connected=hasRoadLevelMovement(roads,
        a[0].properties.road,b[0].properties.road);
      pairs.push({a,b,middle,connected,score:middle+(connected?-65:0)});
    }
  }
  pairs.sort((a,b)=>a.score-b.score);
  if(!pairs.length)return null;
  // When two similarly plausible road combinations exist without road-level
  // connectivity, an aerial-looking line would be misleading.
  if(pairs.length>1 && !pairs[0].connected &&
      pairs[1].score-pairs[0].score<9)return null;
  return pairs[0];
}
function nextTurnPreference(next,offset){
  const turn=expectedLaneTurn(next?.instruction);
  const gap=Number(next?.offset)-offset;
  if(!Number.isFinite(gap)||gap<=0||gap>350)return null;
  if(['left','slight_left','sharp_left'].includes(turn))return 'left';
  if(['right','slight_right','sharp_right'].includes(turn))return 'right';
  return null;
}
function sideOfTurn(turn){
  if(['left','slight_left','sharp_left'].includes(turn))return 'left';
  if(['right','slight_right','sharp_right'].includes(turn))return 'right';
  return null;
}
function selectOrdinal(count,side){
  if(count<1)return -1;
  if(side==='left')return 0;
  if(side==='right')return count-1;
  // With no preferred side, choose a stable, near-middle lane.
  return Math.floor((count-1)/2);
}
function bezierBetween(a,b){
  const start=a.at(-1),end=b[0];
  if(!start||!end||!point(start)||!point(end))return null;
  const span=distance(start,end);
  if(span<3||span>95)return null;
  const before=a.at(-2),after=b[1];
  if(!before||!after)return null;
  const inVec=xy(before,start),outVec=xy(end,after);
  const li=Math.hypot(...inVec),lo=Math.hypot(...outVec);
  if(li<1||lo<1)return null;
  const control=Math.min(22,span*.48);
  const headingIn=[inVec[0]/li,inVec[1]/li];
  const headingOut=[outVec[0]/lo,outVec[1]/lo];
  const lat=(start[1]+end[1])/2;
  const mx=111320*Math.cos(lat*DEG),my=110540;
  const p0=[0,0],p3=xy(start,end);
  const p1=headingIn.map(v=>v*control);
  const p2=[p3[0]-headingOut[0]*control,p3[1]-headingOut[1]*control];
  const points=[];
  for(let i=1;i<=18;i++){
    const t=i/19,u=1-t;
    const x=u*u*u*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t*t*t*p3[0];
    const y=u*u*u*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t*t*t*p3[1];
    points.push([start[0]+x/mx,start[1]+y/my]);
  }
  return points;
}
/**
 * Locally plan a driver's lane position through this turn and into the next.
 * Explicit lane arrows exclude contrary lanes. If arrows are absent, choose
 * the side appropriate for a turn instead of using the road centerline.
 * No network calls and no claimed knowledge of the driver's current lane.
 */
export function planJunctionTrajectory({route,instruction,reconstructed=[],roads=[],
  next=null}={}){
  const fallback={status:'unavailable',reason:'No unambiguous mapped lane path',
    path:empty(),approaches:empty(),exits:empty(),lookahead:null};
  const turn=expectedLaneTurn(instruction),offset=instruction?.routeOffsetInMeters;
  if(!turn||!Number.isFinite(offset)||!Array.isArray(reconstructed))return fallback;
  const approaches=candidateApproachLanePaths(
    route,instruction,reconstructed,{inferUnmarked:true});
  const exits=candidateExitLanePaths(route,instruction,reconstructed);
  const pair=matchGroups(approaches.features,exits.features,roads);
  if(!pair)return {...fallback,approaches,exits};
  const side=sideOfTurn(turn);
  const nextSide=nextTurnPreference(next,offset);
  const approachSide=side || nextSide;
  // Turning lanes keep their natural relative position through the junction.
  // For a straight movement, choose the exit side needed at the NEXT turn.
  const exitSide=side || nextSide;
  const inIndex=selectOrdinal(pair.a.length,approachSide);
  const outIndex=selectOrdinal(pair.b.length,exitSide);
  const incoming=pair.a[inIndex],outgoing=pair.b[outIndex];
  const begin=incoming.geometry.coordinates,end=outgoing.geometry.coordinates;
  const bridge=bezierBetween(begin,end);
  if(!bridge)return {...fallback,approaches,exits};
  const allowed=incoming.properties.allowed_turns||[];
  const explicit=allowed.length>0;
  const coords=[...begin,...bridge,...end].filter(point);
  const path={type:'FeatureCollection',features:[{
    type:'Feature',geometry:{type:'LineString',coordinates:coords},
    properties:{
      status:'provisional',verified:false,method:'two-junction-geometry',
      turn,approachLane:incoming.properties.index,
      exitLane:outgoing.properties.index,
      approachRoad:incoming.properties.road,exitRoad:outgoing.properties.road,
      roadMovementMapped:pair.connected,explicitApproachArrow:explicit,
      nextTurnSide:nextSide||'none',
      description:'Illustrative lane-level path, subject to markings and signs'
    }
  }]};
  return {
    status:'provisional',reason:pair.connected
      ?'Mapped road movement, inferred lane correspondence'
      :'Route-consistent road geometry, inferred connection',
    path,approaches,exits,lookahead:nextSide,
    selected:{approachLane:incoming.properties.index,
      exitLane:outgoing.properties.index,approachOrdinal:inIndex,
      exitOrdinal:outIndex,approachCount:pair.a.length,exitCount:pair.b.length,
      explicit,roadMovementMapped:pair.connected}
  };
}
