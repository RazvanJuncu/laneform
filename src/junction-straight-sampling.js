// Discover important straight-through junctions *inside an already loaded*
// osm2streets area. No extra OSM/TomTom queries. Ordinary road crossings
// are ignored unless the OSM movement graph lists 3+ distinct road arms.
import {routeProfile,positionAtDistance} from './osm-lane-geometry.js';

const DEG=Math.PI/180;
const empty=[];
function point(feature){
  const g=feature?.geometry;
  if(g?.type==='Point'&&Array.isArray(g.coordinates))
    return g.coordinates.slice(0,2);
  const ring=g?.type==='Polygon'?g.coordinates?.[0]:
    g?.type==='MultiPolygon'?g.coordinates?.[0]?.[0]:null;
  if(!Array.isArray(ring)||ring.length<3)return null;
  const samples=ring.filter(p=>Array.isArray(p)&&p.length>=2&&
    p.slice(0,2).every(Number.isFinite));
  if(samples.length<3)return null;
  // Discard repeated closed-ring final vertex if present.
  if(samples.length>3 && samples[0][0]===samples.at(-1)[0] &&
    samples[0][1]===samples.at(-1)[1])samples.pop();
  return [samples.reduce((sum,p)=>sum+p[0],0)/samples.length,
    samples.reduce((sum,p)=>sum+p[1],0)/samples.length];
}
function roadArms(feature){
  if(String(feature?.properties?.type||'').toLowerCase()!=='intersection')
    return 0;
  const movements=feature.properties?.movements;
  if(!Array.isArray(movements))return 0;
  const arms=new Set();
  for(const movement of movements){
    // osm2streets uses Rust's Display representation of RoadID; releases
    // may serialize identifiers as "12", "Road #12", or "RoadID(12)".
    // Requiring bare digits silently missed every normal intersection in
    // those builds, leaving Cruise without any candidate crossings.
    const pieces=String(movement).split(/\s*->\s*/);
    if(pieces.length!==2)continue;
    const from=pieces[0].trim(),to=pieces[1].trim();
    if(from&&to){arms.add(from);arms.add(to);}
  }
  return arms.size;
}
function xy(a,b){
  return [(b[0]-a[0])*111320*
    Math.cos((a[1]+b[1])/2*DEG),(b[1]-a[1])*110540];
}
function project(profile,p){
  let best=null;
  for(let i=1;i<profile.points.length;i++){
    const a=profile.points[i-1],b=profile.points[i],v=xy(a,b),
      w=xy(a,p);
    const magnitude=v[0]*v[0]+v[1]*v[1];
    if(magnitude<1)continue;
    const t=Math.max(0,Math.min(1,(w[0]*v[0]+w[1]*v[1])/magnitude));
    const distance=Math.hypot(w[0]-v[0]*t,w[1]-v[1]*t);
    const at=profile.cumulative[i-1]+
      (profile.cumulative[i]-profile.cumulative[i-1])*t;
    if(!best||distance<best.distance)best={at,distance};
  }
  return best;
}
function continuesStraight(profile,at){
  const p0=positionAtDistance(profile,Math.max(0,at-18));
  const p1=positionAtDistance(profile,at);
  const p2=positionAtDistance(profile,Math.min(profile.length,at+18));
  if(!p0||!p1||!p2)return false;
  const a=xy(p0,p1),b=xy(p1,p2);
  const magA=Math.hypot(...a),magB=Math.hypot(...b);
  return magA>4&&magB>4&&
    (a[0]*b[0]+a[1]*b[1])/(magA*magB)>Math.cos(30*DEG);
}
export function sampleImportantThroughJunctions({
  route,roads=[],centerOffset,excludeOffsets=[],beforeMeters=155
}={}){
  const total=route?.properties?.summary?.lengthInMeters;
  if(!Number.isFinite(total)||total<=0||!Number.isFinite(centerOffset)||
    !Array.isArray(roads))return empty;
  const profile=routeProfile(route);
  if(profile.length<60)return empty;
  const matches=[];
  for(const feature of roads){
    const arms=roadArms(feature);
    if(arms<3)continue;
    const center=point(feature);
    if(!center)continue;
    const near=project(profile,center);
    if(!near||near.distance>11)continue;
    const offset=near.at/profile.length*total;
    if(offset<centerOffset-beforeMeters||offset>centerOffset-48 ||
      excludeOffsets.some(v=>Number.isFinite(v)&&Math.abs(v-offset)<42))
      continue;
    if(!continuesStraight(profile,near.at))continue;
    matches.push({offset,position:center,arms,kind:'through',
      status:'osm-inferred'});
  }
  matches.sort((a,b)=>a.offset-b.offset);
  return matches.filter((m,i)=>i===0||m.offset-matches[i-1].offset>45);
}
