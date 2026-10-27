// Smooth a maneuver between stable reconstructed lane sections.
// Raw OSM polygons often overlap or terminate inside intersections; sampling
// them every few metres there causes impossible lane jumps and zig-zags.
// TomTom supplies only the chosen road maneuver position; the endpoints and
// tangents here come exclusively from actual reconstructed driving-lane samples.
const RAD=Math.PI/180;
const valid=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
function metric(a,b){
  const mid=(a[1]+b[1])*.5;
  return [(b[0]-a[0])*111320*Math.cos(mid*RAD),
    (b[1]-a[1])*110540];
}
function len(v){return Math.hypot(v[0],v[1]);}
function norm(v){const l=len(v);return l>.01?[v[0]/l,v[1]/l]:null;}
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
function cubic(a,b,dirIn,dirOut,steps){
  const displacement=metric(a,b),chord=len(displacement);
  const pull=Math.min(18,chord*.49);
  const p1=[dirIn[0]*pull,dirIn[1]*pull];
  const p2=[displacement[0]-dirOut[0]*pull,
    displacement[1]-dirOut[1]*pull];
  const cos=Math.max(.1,Math.cos(a[1]*RAD));
  const curve=[];
  for(let i=0;i<=steps;i++){
    const t=i/steps,u=1-t;
    const x=3*u*u*t*p1[0]+3*u*t*t*p2[0]+t*t*t*displacement[0];
    const y=3*u*u*t*p1[1]+3*u*t*t*p2[1]+t*t*t*displacement[1];
    curve.push([a[0]+x/(111320*cos),a[1]+y/110540]);
  }
  return curve;
}
// A compact fillet at the intersection of the approach and exit lane
// tangents. A single cubic between anchors ~40-70 m apart bends too early;
// for roughly orthogonal turns, use straight legs and a short-radius corner.
// Endpoints and bearings come from reconstructed lane samples, not TomTom.
function compactCorner(a,b,dirIn,dirOut,steps,{
  minRadius=4.5,maxRadius=9
}={}){
  const d=metric(a,b),span=len(d);
  const cosine=Math.max(-1,Math.min(1,dot(dirIn,dirOut)));
  const angle=Math.acos(cosine);
  if(angle<Math.PI/4.5||angle>Math.PI*.74)return null;
  const cross=(u,v)=>u[0]*v[1]-u[1]*v[0];
  const denom=cross(dirIn,dirOut);
  if(Math.abs(denom)<.22)return null;
  // Corner Q = A + forward*entryLength = B - exit*exitLength.
  const entryLength=cross(d,dirOut)/denom;
  const exitLength=cross(dirIn,d)/denom;
  if(entryLength<4||exitLength<4||
    entryLength>120||exitLength>120)return null;
  const tangent=Math.tan(angle/2);
  if(!Number.isFinite(tangent)||tangent<=0)return null;
  const requested=Math.max(minRadius,
    Math.min(maxRadius,span*.18));
  const radius=Math.min(requested,
    Math.min(entryLength,exitLength)*.78/tangent);
  if(radius<minRadius*.75)return null;
  const setback=radius*tangent;
  const start=[dirIn[0]*(entryLength-setback),
    dirIn[1]*(entryLength-setback)];
  const end=[d[0]-dirOut[0]*(exitLength-setback),
    d[1]-dirOut[1]*(exitLength-setback)];
  const pull=4/3*Math.tan(angle/4)*radius;
  const cp1=[start[0]+dirIn[0]*pull,
    start[1]+dirIn[1]*pull];
  const cp2=[end[0]-dirOut[0]*pull,
    end[1]-dirOut[1]*pull];
  const bezier=(t)=>{
    const u=1-t;
    return [
      u*u*u*start[0]+3*u*u*t*cp1[0]+3*u*t*t*cp2[0]+t*t*t*end[0],
      u*u*u*start[1]+3*u*u*t*cp1[1]+3*u*t*t*cp2[1]+t*t*t*end[1]
    ];
  };
  // Arc-length resampling keeps the 5m route intervals visually uniform,
  // while making the 90-degree corner significantly tighter than the old
  // whole-span cubic. Preserve exact endpoints for connection to OSM lanes.
  const poly=[[0,0],start];
  const count=Math.max(12,Math.ceil(angle*radius/1.3));
  for(let k=1;k<=count;k++)poly.push(bezier(k/count));
  poly.push(d);
  const cumulative=[0];
  for(let i=1;i<poly.length;i++)
    cumulative.push(cumulative.at(-1)+len([
      poly[i][0]-poly[i-1][0],poly[i][1]-poly[i-1][1]
    ]));
  const total=cumulative.at(-1);
  if(total<3)return null;
  const cos=Math.max(.1,Math.cos(a[1]*RAD));
  const coords=[];
  let idx=1;
  for(let i=0;i<=steps;i++){
    const along=total*i/steps;
    while(idx<cumulative.length-1&&cumulative[idx]<along)idx++;
    const segment=cumulative[idx]-cumulative[idx-1];
    const t=segment>0?(along-cumulative[idx-1])/segment:0;
    const x=poly[idx-1][0]+t*(poly[idx][0]-poly[idx-1][0]);
    const y=poly[idx-1][1]+t*(poly[idx][1]-poly[idx-1][1]);
    coords.push([a[0]+x/(111320*cos),a[1]+y/110540]);
  }
  coords[0]=a;coords[steps]=b;
  return {curve:coords,radius,cornerAngleDegrees:angle*180/Math.PI,
    entryLength,exitLength};
}
function sameLane(a,b){
  return a&&b&&a.road===b.road&&a.direction===b.direction&&
    a.index===b.index;
}
function stableNeighbor(samples,index,sign){
  const candidate=samples[index];
  const neighbor=samples[index+sign];
  if(!candidate||!neighbor||!sameLane(candidate,neighbor)||
    Math.abs(candidate.d-neighbor.d)>8)return null;
  return neighbor;
}
/**
 * Refine one known TomTom maneuver by ignoring overlapping road polygons
 * inside it, and interpolating between mapped approach/exit lanes.
 * Reject uncertain geometry instead of suggesting a physical lane connector.
 */
export function smoothMappedTurn(samples,{turnDistance,
  minTrim=21,maxGap=86,routeDistance=null}={}){
  const unchanged={samples,bridged:false,reason:'No stable maneuver endpoints'};
  if(!Array.isArray(samples)||samples.length<8||
    !Number.isFinite(turnDistance))return unchanged;
  // Try a modest trim first, expanding if the lane sections are sparse.
  // The two anchors must have their own continuous mapped directions.
  for(const trim of [minTrim,27,34]){
    let before=-1,after=-1;
    for(let i=0;i<samples.length;i++){
      const s=samples[i];
      if(!s||!valid(s.point))continue;
      if(s.d<=turnDistance-trim && stableNeighbor(samples,i,-1))before=i;
      if(after===-1 && s.d>=turnDistance+trim &&
        stableNeighbor(samples,i,1))after=i;
    }
    if(before<1||after<=before+1)continue;
    const entry=samples[before],exit=samples[after];
    const p0=stableNeighbor(samples,before,-1);
    const p1=stableNeighbor(samples,after,1);
    const gap=exit.d-entry.d;
    if(gap<12||gap>maxGap)continue;
    if(sameLane(entry,exit) && gap<minTrim*2)continue;
    const d=metric(entry.point,exit.point),span=len(d);
    if(span<5||span>maxGap*1.22)continue;
    const inHeading=norm(metric(p0.point,entry.point));
    const outHeading=norm(metric(exit.point,p1.point));
    if(!inHeading||!outHeading||dot(inHeading,outHeading)<-.85)continue;
    // The connector must make forward progress at both ends. A 180-degree
    // reversal here is usually an incorrect polygon match, not a normal turn.
    const chord=norm(d);
    if(!chord||dot(inHeading,chord)<-.28||
      dot(outHeading,chord)<-.28)continue;
    const bend=Math.acos(Math.max(-1,Math.min(1,
      dot(inHeading,outHeading))));
    if(bend<.14 && span>45)continue;
    const count=after-before;
    const fillet=compactCorner(entry.point,exit.point,
      inHeading,outHeading,count);
    const curve=fillet?.curve||cubic(entry.point,exit.point,
      inHeading,outHeading,count);
    if(typeof routeDistance==='function'){
      const routeOk=curve.every((point,k)=>{
        const d=entry.d+(exit.d-entry.d)*k/count;
        return routeDistance(point,d)<=24;
      });
      if(!routeOk)continue;
    }
    const next=samples.slice();
    for(let k=before+1;k<after;k++){
      // Do not attach artificial lane metadata to geometric connectors.
      // HUD only reads genuine polygon samples, never these spline points.
      next[k]={d:samples[k]?.d ??
        entry.d+(exit.d-entry.d)*(k-before)/count,
        point:curve[k-before],syntheticTurn:true};
    }
    return {samples:next,bridged:true,reason:'Smooth mapped-lane turn',
      method:fillet?'compact-corner':'cubic',
      cornerRadiusMeters:fillet?.radius??null,
      cornerAngleDegrees:fillet?.cornerAngleDegrees??null,
      endpoints:[entry.point,exit.point],trim,gap};
  }
  // Suppress samples within the turning box when we cannot identify both
  // stable lane endpoints. This prevents false zigzags: regular road-level
  // navigation remains visible where no mapped connector can be supported.
  const next=samples.map(s=>s&&Math.abs(s.d-turnDistance)<minTrim
    ?null:s);
  return {samples:next,bridged:false,reason:
    'No credible lane-to-lane connector; suppress inconsistent junction points'};
}
