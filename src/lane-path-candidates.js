// Provisional approach-lane traces for junction INSPECTION only.
// osm2streets exports lane type, index, road ID and allowed_turns per lane.
// We combine these with the chosen maneuver and local route geometry.
// Critically: NO lane-to-lane junction transition is inferred here.
// Only trace within a long aligned approach polygon; do not enter/cross the
// intersection, and do not claim which physical lane the user occupies.
import {routeProfile,positionAtDistance,maneuverDirection} from './osm-lane-geometry.js';
const DEG=Math.PI/180;
const SAMPLE_STEP=9;
const MIN_SPAN=23;
const APPROACH_START=113;
const APPROACH_END=22;
const CAST_METERS=22;
const MAX_OFFSET=17;
const empty=()=>({type:'FeatureCollection',features:[]});

export function normalizeAllowedTurn(value){
  if(!Array.isArray(value))return [];
  return [...new Set(value.map(x=>String(x).trim().toLowerCase()))];
}
export function expectedLaneTurn(instruction){
  const dir=maneuverDirection(instruction);
  if(!dir)return null;
  if(dir==='STRAIGHT')return 'through';
  if(dir==='LEFT'||dir==='RIGHT')return dir.toLowerCase();
  if(dir==='SLIGHT_LEFT'||dir==='SLIGHT_RIGHT'||
    dir==='SHARP_LEFT'||dir==='SHARP_RIGHT')return dir.toLowerCase();
  return null;
}
function segmentsInPolygon(feature){
  const {geometry}=feature||{};
  const polygons=geometry?.type==='Polygon'?[geometry.coordinates]:
    geometry?.type==='MultiPolygon'?geometry.coordinates:[];
  const segments=[];
  for(const poly of polygons){
    for(const ring of poly||[]){
      if(!Array.isArray(ring)||ring.length<4)continue;
      for(let i=1;i<ring.length;i++){
        const a=ring[i-1],b=ring[i];
        if(Array.isArray(a)&&Array.isArray(b) &&
          [a[0],a[1],b[0],b[1]].every(Number.isFinite))
          segments.push([a,b]);
      }
    }
  }
  return segments;
}
function cross(a,b){return a[0]*b[1]-a[1]*b[0];}
function lineIntersection(p,r,q,s){
  const denominator=cross(r,s);
  if(Math.abs(denominator)<1e-8)return null;
  const from=[q[0]-p[0],q[1]-p[1]];
  const t=cross(from,s)/denominator,u=cross(from,r)/denominator;
  if(t>=0&&t<=1&&u>=-1e-6&&u<=1+1e-6)return t;
  return null;
}
function laneCrossSection(center,tangent,segments){
  const cosLat=Math.max(.01,Math.cos(center[1]*DEG));
  const east=(tangent[0])*111320*cosLat;
  const north=(tangent[1])*110540;
  const len=Math.hypot(east,north);
  if(len<.5)return null;
  const normal=[-north/len,east/len];
  const origin=[-CAST_METERS*normal[0],-CAST_METERS*normal[1]];
  const ray=[2*CAST_METERS*normal[0],2*CAST_METERS*normal[1]];
  const hits=[];
  for(const [a,b] of segments){
    const ax=(a[0]-center[0])*111320*cosLat,ay=(a[1]-center[1])*110540;
    const bx=(b[0]-center[0])*111320*cosLat,by=(b[1]-center[1])*110540;
    const t=lineIntersection(origin,ray,[ax,ay],[bx-ax,by-ay]);
    if(t!==null)hits.push(t*CAST_METERS*2-CAST_METERS);
  }
  hits.sort((a,b)=>a-b);
  const unique=hits.filter((v,i)=>i===0||v-hits[i-1]>.07);
  if(unique.length<2||unique.length%2!==0)return null;
  let best=null;
  for(let i=0;i<unique.length;i+=2){
    const mid=(unique[i]+unique[i+1])/2;
    const width=unique[i+1]-unique[i];
    if(width<1.5||width>8||Math.abs(mid)>MAX_OFFSET)continue;
    if(best===null||Math.abs(mid)<Math.abs(best))best=mid;
  }
  if(best===null)return null;
  return [
    center[0]+best*normal[0]/(111320*cosLat),
    center[1]+best*normal[1]/110540
  ];
}
export function candidateApproachLanePaths(route,instruction,features){
  const result=empty();
  const expected=expectedLaneTurn(instruction);
  const total=route?.properties?.summary?.lengthInMeters;
  const offset=instruction?.routeOffsetInMeters;
  if(!expected||!Number.isFinite(total)||!Number.isFinite(offset)||
    !Array.isArray(features)||offset<APPROACH_END+MIN_SPAN)return result;
  const profile=routeProfile(route);
  if(profile.length<50||total<=0)return result;
  const scale=profile.length/total;
  const at=offset*scale;
  const from=Math.max(0,at-APPROACH_START*scale);
  const to=Math.max(0,at-APPROACH_END*scale);
  if(to-from<MIN_SPAN)return result;
  for(const feature of features){
    const props=feature?.properties||{};
    if(String(props.type).toLowerCase()!=='driving')continue;
    if(!Number.isInteger(props.index)||!Number.isInteger(props.road))continue;
    if(!normalizeAllowedTurn(props.allowed_turns).includes(expected))continue;
    const segments=segmentsInPolygon(feature);
    if(segments.length<3)continue;
    let trace=[],longest=[];
    for(let d=from;d<=to;d+=SAMPLE_STEP){
      const here=positionAtDistance(profile,d);
      const prev=positionAtDistance(profile,Math.max(0,d-4));
      const next=positionAtDistance(profile,Math.min(profile.length,d+4));
      const point=here&&prev&&next?
        laneCrossSection(here,[next[0]-prev[0],next[1]-prev[1]],segments):null;
      if(point){
        trace.push(point);
      }else{
        if(trace.length>longest.length)longest=trace;
        trace=[];
      }
    }
    if(trace.length>longest.length)longest=trace;
    if(longest.length<4 || longest.length*SAMPLE_STEP<MIN_SPAN)continue;
    result.features.push({
      type:'Feature',geometry:{type:'LineString',coordinates:longest},
      properties:{
        road:props.road,index:props.index,turn:expected,
        source:'osm2streets',status:'candidate-only',
        label:'Mapped turn-arrow candidate — not verified lane connectivity'
      }
    });
  }
  // Too many possible lanes is evidence of ambiguity: no confident
  // centerline choice. In that case we show only underlying polygons.
  if(result.features.length>4)return empty();
  return result;
}
