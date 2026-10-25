// Route-relative lane geometry focus — deliberately NOT lane-level navigation.
// Matches reconstructed OSM lane polygons against a short segment of the
// already-calculated provider route using proximity and orientation.
// The matching selects VISUAL emphasis only. It does not establish legal
// maneuver connectivity or silently move the navigation route into a lane.
import {routeProfile,positionAtDistance} from './osm-lane-geometry.js';

const RADIANS=Math.PI/180;
const X_METERS=111320;
const Y_METERS=110540;
export const FOCUS_LIMIT_METERS=22;
export const MARKING_LIMIT_METERS=20;
export const HALF_WINDOW_METERS=165;

const empty=()=>({type:'FeatureCollection',features:[]});
const deltaLon=(a,b)=>((b-a+540)%360)-180;

function metricVector(a,b,referenceLatitude){
  return [
    deltaLon(a[0],b[0])*X_METERS*Math.cos(referenceLatitude*RADIANS),
    (b[1]-a[1])*Y_METERS
  ];
}
export function segmentDistanceMeters(point,a,b){
  const ref=point[1];
  const v=metricVector(a,b,ref),w=metricVector(a,point,ref);
  const n=v[0]*v[0]+v[1]*v[1];
  const t=n>1e-9?Math.max(0,Math.min(1,(w[0]*v[0]+w[1]*v[1])/n)):0;
  return Math.hypot(w[0]-v[0]*t,w[1]-v[1]*t);
}
function closest(point,route){
  let best=Infinity;
  for(let i=1;i<route.length;i++)
    best=Math.min(best,segmentDistanceMeters(point,route[i-1],route[i]));
  return best;
}
function ringSamples(geometry){
  // The center plus representative ring points let narrow, long road
  // polygons align without accepting crossing arms just because one vertex
  // touches the provider's road centerline.
  if(!geometry||!Array.isArray(geometry.coordinates))return [];
  const polygons=geometry.type==='Polygon'
    ? [geometry.coordinates] : geometry.type==='MultiPolygon'
      ? geometry.coordinates : [];
  const results=[];
  for(const polygon of polygons){
    const ring=polygon?.[0];
    if(!Array.isArray(ring)||ring.length<4)continue;
    let x=0,y=0,n=0,west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
    for(const point of ring){
      if(!Array.isArray(point)||!Number.isFinite(point[0])||
         !Number.isFinite(point[1]))continue;
      x+=point[0];y+=point[1];n++;
      west=Math.min(west,point[0]);east=Math.max(east,point[0]);
      south=Math.min(south,point[1]);north=Math.max(north,point[1]);
    }
    if(n<3)continue;
    // Closed polygon points introduce negligible centroid bias.
    results.push({center:[x/n,y/n],ring,extent:[west,south,east,north]});
  }
  return results;
}
function lineSamples(geometry){
  if(!geometry||!Array.isArray(geometry.coordinates))return [];
  const lines=geometry.type==='LineString'?[geometry.coordinates]:
    geometry.type==='MultiLineString'?geometry.coordinates:[];
  const out=[];
  for(const line of lines){
    if(!Array.isArray(line)||line.length<2)continue;
    const valid=line.filter(p=>Array.isArray(p)&&p.length>=2&&
      Number.isFinite(p[0])&&Number.isFinite(p[1]));
    if(valid.length<2)continue;
    out.push(valid[0],valid[valid.length-1],
      valid[Math.floor(valid.length/2)]);
  }
  return out;
}
export function localRouteWindow(route,junctionOffset,halfWindow=HALF_WINDOW_METERS){
  const profile=routeProfile(route);
  const routeMeters=route?.properties?.summary?.lengthInMeters;
  if(!Number.isFinite(junctionOffset)||!Number.isFinite(routeMeters)||
      routeMeters<=0||profile.length<=0)return [];
  const target=Math.max(0,Math.min(profile.length,
    junctionOffset*profile.length/routeMeters));
  const from=Math.max(0,target-halfWindow),to=Math.min(profile.length,target+halfWindow);
  const out=[];
  const at=(v)=>positionAtDistance(profile,v);
  const start=at(from),end=at(to);
  if(!start||!end)return [];
  out.push(start);
  // Preserve turns within the window; a straight chord would confuse
  // perpendicular approaches with the chosen routed exit.
  for(let i=1;i<profile.points.length-1;i++){
    if(profile.cumulative[i]>from&&profile.cumulative[i]<to)
      out.push(profile.points[i]);
  }
  out.push(end);
  return out;
}
export function partitionJunctionGeometry(data,route,junctionOffset){
  const window=localRouteWindow(route,junctionOffset);
  const features=data?.lanes?.features;
  const marks=data?.markings?.features||[];
  const result={
    context:empty(),focus:empty(),markings:empty(),
    summary:{
      supported:window.length>=2,
      considered:Array.isArray(features)?features.length:0,
      matchedCount:0,markingCount:0,
      method:'route-proximity',
      evidence:'Unverified geometry proximity; not lane-to-lane connectivity'
    }
  };
  if(!Array.isArray(features)){
    return result;
  }
  // If a provider route is absent or corrupt, preserve visual context but
  // refuse to assert which of the surrounding lanes relates to the path.
  for(const feature of features){
    const polygons=ringSamples(feature?.geometry);
    if(polygons.length===0)continue;
    let eligible=false;
    if(window.length>=2)for(const polygon of polygons){
      const centerDistance=closest(polygon.center,window);
      // A lane polygon must have its representative center near the path;
      // one shared corner is insufficient for a lane emphasis match.
      if(centerDistance<=FOCUS_LIMIT_METERS)eligible=true;
    }
    if(eligible)result.focus.features.push(feature);
    else result.context.features.push(feature);
  }
  const markingCandidates=marks.filter(feature=>{
    if(window.length<2)return false;
    const lines=lineSamples(feature?.geometry);
    const polygons=ringSamples(feature?.geometry);
    const points=[...lines,...polygons.map(p=>p.center)];
    return points.length>0 &&
      points.some(point=>closest(point,window)<=MARKING_LIMIT_METERS);
  });
  result.markings.features=markingCandidates;
  result.summary.matchedCount=result.focus.features.length;
  result.summary.markingCount=markingCandidates.length;
  return result;
}
