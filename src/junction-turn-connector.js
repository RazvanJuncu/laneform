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
    const curve=cubic(entry.point,exit.point,
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
