// Last gate for lane-level visual paths at routed THROUGH movements.
// If the provider road is locally straight but the inferred lane suddenly
// cuts across it, split the green path instead of rendering a false kink.
// The provider road-level line remains behind uncovered sections.
const RAD=Math.PI/180;
function xy(a,b){
  const lat=(a[1]+b[1])*.5;
  return [(b[0]-a[0])*111320*Math.max(.1,Math.cos(lat*RAD)),
    (b[1]-a[1])*110540];
}
const valid=p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite);
function alignment(a,b,c,d){
  const v=xy(a,b),w=xy(c,d);
  const n=Math.hypot(...v)*Math.hypot(...w);
  return n>1?(v[0]*w[0]+v[1]*w[1])/n:1;
}
export function splitImplausibleThroughPath(samples,{
  profile,positionAtDistance,maxDivergenceDegrees=33
}={}){
  if(!Array.isArray(samples)||samples.length<3||
    typeof positionAtDistance!=='function'||!profile)
    return {pieces:Array.isArray(samples)?[samples]:[],rejected:0};
  const limit=Math.cos(maxDivergenceDegrees*RAD);
  const pieces=[];let section=[samples[0]],rejected=0;
  for(let i=1;i<samples.length;i++){
    const before=samples[i-1],after=samples[i];
    if(!valid(before?.point)||!valid(after?.point)||
      !Number.isFinite(before.d)||!Number.isFinite(after.d)){
      if(section.length>=2)pieces.push(section);
      section=[after];continue;
    }
    const pathA=positionAtDistance(profile,before.d);
    const pathB=positionAtDistance(profile,after.d);
    const ahead=positionAtDistance(profile,
      Math.min(profile.length,after.d+6));
    const behind=positionAtDistance(profile,
      Math.max(0,before.d-6));
    const providerStraight=valid(ahead)&&valid(behind)&&
      valid(pathA)&&valid(pathB)&&
      alignment(behind,pathA,pathB,ahead)>.93;
    const diverges=providerStraight&&
      alignment(pathA,pathB,before.point,after.point)<limit;
    // d-range must also represent nearby mapped samples; a long bridged
    // gap is already handled by the corridor's own interpolation limits.
    if(diverges && after.d-before.d<=15){
      if(section.length>=2)pieces.push(section);
      section=[after];rejected++;
    }else section.push(after);
  }
  if(section.length>=2)pieces.push(section);
  return {pieces,rejected};
}
