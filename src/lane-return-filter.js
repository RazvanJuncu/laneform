// Repair temporary "out and back" lane-centreline detours on roads the
// provider says are locally straight. These OSM polygon mismatches often
// survive median filtering: a pair of neighboring bad samples can appear
// internally consistent. Unlike smoothing all samples, this algorithm only
// accepts a departure that demonstrably RETURNS to the same carriageway.
const RAD=Math.PI/180;
const valid=p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite);
function delta(a,b){
  return [(b[0]-a[0])*111320*Math.cos((a[1]+b[1])*.5*RAD),
    (b[1]-a[1])*110540];
}
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
function basis(sample,profile,pointAt){
  if(!sample||!valid(sample.point)||!Number.isFinite(sample.d))return null;
  const center=pointAt(profile,sample.d);
  const before=pointAt(profile,Math.max(0,sample.d-8));
  const after=pointAt(profile,Math.min(profile.length,sample.d+8));
  if(!valid(center)||!valid(before)||!valid(after))return null;
  const v=delta(before,after),m=Math.hypot(...v);
  if(m<5)return null;
  const tangent=[v[0]/m,v[1]/m],normal=[-tangent[1],tangent[0]];
  return {center,tangent,normal,lateral:dot(delta(center,sample.point),normal)};
}
export function repairReturningLaneDetours(samples,{profile,positionAtDistance,
  maxSamples=5,minDeviation=1.55,maxAnchorOffset=1.05}={}){
  const diagnostics={repaired:0,events:0};
  if(!Array.isArray(samples)||samples.length<6||!profile||
    typeof positionAtDistance!=='function')
    return {samples,diagnostics};
  const readings=samples.map(s=>basis(s,profile,positionAtDistance));
  const output=samples.slice();
  let i=1;
  while(i<samples.length-2){
    const left=readings[i-1],prev=readings[i-2];
    if(!left||!prev||!readings[i]||
      Math.abs(left.lateral-prev.lateral)>maxAnchorOffset||
      Math.abs(readings[i].lateral-left.lateral)<minDeviation){
      i++;continue;
    }
    // Search for a nearby pair of stable return anchors, allowing up to
    // five transient wrong samples (5m each). Prefer the shortest return.
    let found=null;
    for(let end=i+1;end<=Math.min(samples.length-2,i+maxSamples+1);end++){
      const right=readings[end],next=readings[end+1];
      if(!right||!next||!samples[end]||!samples[end+1])continue;
      const gap=samples[end].d-samples[i-1].d;
      if(gap<=0||gap>37)continue;
      const sameOffset=Math.abs(right.lateral-left.lateral)<=maxAnchorOffset;
      if(!sameOffset||Math.abs(next.lateral-right.lateral)>maxAnchorOffset)
        continue;
      // The underlying route has to be locally straight THROUGH the event.
      const bearings=[prev,left,...readings.slice(i,end+2)];
      if(bearings.some(v=>!v||dot(v.tangent,left.tangent)<Math.cos(13*RAD)))
        continue;
      let worst=0,available=true;
      for(let k=i;k<end;k++){
        const p=readings[k];
        if(!p){available=false;break;}
        const t=(samples[k].d-samples[i-1].d)/gap;
        const baseline=left.lateral+(right.lateral-left.lateral)*t;
        worst=Math.max(worst,Math.abs(p.lateral-baseline));
      }
      if(available&&worst>=minDeviation){found=end;break;}
    }
    if(found===null){i++;continue;}
    const begin=i-1,end=found;
    const gap=samples[end].d-samples[begin].d;
    for(let k=i;k<end;k++){
      const sample=samples[k],p=readings[k];
      const t=(sample.d-samples[begin].d)/gap;
      const lateral=left.lateral+
        (readings[end].lateral-left.lateral)*t;
      const cos=Math.max(.1,Math.cos(p.center[1]*RAD));
      output[k]={...sample,point:[
        p.center[0]+lateral*p.normal[0]/(111320*cos),
        p.center[1]+lateral*p.normal[1]/110540
      ],hudEligible:false,detourRepaired:true};
      diagnostics.repaired++;
    }
    diagnostics.events++;
    i=end+1;
  }
  return {samples:output,diagnostics};
}
