// Suppress brief OSM polygon mismatches on a geometrically straight road.
// A driving-lane cross-section can momentarily snap to a tiny crossing-road
// polygon. That yields the triangular teeth seen in Junction Detail, even
// though the selected TomTom road continues straight. Keep legitimate bends
// and stable lane changes; adjust only short-lived lateral outliers.
const RAD=Math.PI/180;
const valid=p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite);
const median=values=>{
  const list=[...values].sort((a,b)=>a-b);
  return list.length%2?list[(list.length-1)/2]:
    (list[list.length/2-1]+list[list.length/2])/2;
};
function displacement(a,b){
  const c=Math.max(.1,Math.cos((a[1]+b[1])*.5*RAD));
  return [(b[0]-a[0])*111320*c,(b[1]-a[1])*110540];
}
function normalized(vector){
  const l=Math.hypot(...vector);
  return l>.01?[vector[0]/l,vector[1]/l]:null;
}
function projected(sample,profile,positionAtDistance){
  if(!sample||!valid(sample.point))return null;
  const center=positionAtDistance(profile,sample.d);
  const prior=positionAtDistance(profile,Math.max(0,sample.d-5));
  const next=positionAtDistance(profile,
    Math.min(profile.length,sample.d+5));
  if(!valid(center)||!valid(prior)||!valid(next))return null;
  const tangent=normalized(displacement(prior,next));
  if(!tangent)return null;
  const normal=[-tangent[1],tangent[0]];
  const local=displacement(center,sample.point);
  return {center,normal,
    lateral:local[0]*normal[0]+local[1]*normal[1],
    tangent};
}
export function suppressLaneSamplingSpikes(samples,{
  profile,positionAtDistance,windowRadius=3,
  thresholdMeters=1.65
}={}){
  const diagnostics={corrected:0,discarded:0,inspected:0};
  if(!Array.isArray(samples)||samples.length<2||!profile||
    typeof positionAtDistance!=='function')
    return {samples,diagnostics};
  // Work from the original series, never from corrections we just made.
  const measured=samples.map(s=>projected(s,profile,positionAtDistance));
  const output=samples.slice();
  for(let i=windowRadius;i<samples.length-windowRadius;i++){
    const p=measured[i];
    if(!p)continue;
    const neighbors=[];
    for(let j=i-windowRadius;j<=i+windowRadius;j++){
      if(j===i||!measured[j])continue;
      if(Math.abs(samples[j].d-samples[i].d)>windowRadius*6)continue;
      neighbors.push(measured[j]);
    }
    if(neighbors.length<4)continue;
    // Only filter locally STRAIGHT stretches of the original route;
    // actual 90-degree junction geometry must remain untouched.
    if(neighbors.some(n=>n.tangent[0]*p.tangent[0]+
      n.tangent[1]*p.tangent[1]<Math.cos(12*RAD)))continue;
    const baseline=median(neighbors.map(n=>n.lateral));
    const agree=neighbors.filter(n=>
      Math.abs(n.lateral-baseline)<1.05).length;
    if(agree<Math.ceil(neighbors.length*.67))continue;
    const deviation=Math.abs(p.lateral-baseline);
    diagnostics.inspected++;
    if(deviation<thresholdMeters)continue;
    if(deviation>10){
      // A huge unexplained jump is not a lane; keep the road-level fallback
      // rather than painting over the wrong carriageway.
      output[i]=null;diagnostics.discarded++;continue;
    }
    const cos=Math.max(.1,Math.cos(p.center[1]*RAD));
    output[i]={...samples[i],point:[
      p.center[0]+baseline*p.normal[0]/(111320*cos),
      p.center[1]+baseline*p.normal[1]/110540
    ],spikeCorrected:true};
    diagnostics.corrected++;
  }
  return {samples:output,diagnostics};
}
