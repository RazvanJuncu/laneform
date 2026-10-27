// Continuous road-geometry anticipation. No TomTom maneuver is necessary:
// follow stable on-route osm2streets lane cross sections and compare the lane
// positions before and after a branch / lane drop. Merely seeing 2 -> 3
// lanes is NOT enough to declare which lane exits; a stable 3 -> 2 pattern
// and unique geometric continuation are required.
const finiteOffsets=f=>Array.isArray(f?.offsets)&&
  f.offsets.length===f.laneCount&&f.laneCount>=2&&f.laneCount<=9&&
  f.offsets.every(Number.isFinite);
const safeFrame=f=>finiteOffsets(f)&&Number.isFinite(f.at)&&
  typeof f.direction==='string'&&f.direction!=='Inferred'&&
  f.road!==null&&f.road!==undefined;
const median=x=>{const a=[...x].sort((a,b)=>a-b);
  return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;};
function groupAt(frames,index){
  const seed=frames[index];
  if(!safeFrame(seed))return null;
  const matching=f=>safeFrame(f)&&f.laneCount===seed.laneCount&&
    f.road===seed.road&&f.direction===seed.direction&&
    f.offsets.every((v,j)=>Math.abs(v-seed.offsets[j])<=1.15);
  const matches=frames.filter(f=>matching(f)&&Math.abs(f.at-seed.at)<=15);
  if(matches.length<2||
    Math.max(...matches.map(f=>f.at))-Math.min(...matches.map(f=>f.at))<4)
    return null;
  return {at:median(matches.map(f=>f.at)),offsets:seed.offsets,
    n:seed.laneCount,road:seed.road,direction:seed.direction,
    samples:matches.length};
}
function subsets(big,small){
  const all=[];
  function go(start,indices){
    if(indices.length===small){
      all.push(indices);return;
    }
    for(let i=start;i<=big-(small-indices.length);i++)
      go(i+1,[...indices,i]);
  }
  go(0,[]);return all;
}
function continuity(pre,post){
  if(pre.n!==post.n+1||pre.n<3||post.n<2)return null;
  const scored=subsets(pre.n,post.n).map(indices=>{
    const diffs=indices.map((x,j)=>post.offsets[j]-pre.offsets[x]);
    // A small common shift is expected when the route centreline drifts;
    // an incompatible lateral pattern must not produce a lane instruction.
    const drift=median(diffs);
    const residuals=diffs.map(v=>Math.abs(v-drift));
    return {indices,drift,worst:Math.max(...residuals),
      cost:residuals.reduce((a,b)=>a+b,0)+Math.abs(drift)*.25};
  }).filter(x=>x.worst<=1.35&&Math.abs(x.drift)<=2.4)
    .sort((a,b)=>a.cost-b.cost);
  if(!scored.length||scored.length>1&&
    scored[1].cost-scored[0].cost<.65)return null;
  return scored[0];
}
export function cruiseFromLaneContinuity({
  laneFrames=[],progress=0,horizonMeters=410,
  nextTurnOffset=null,nextTurnDirection=null
}={}){
  if(!Array.isArray(laneFrames)||!Number.isFinite(progress))return null;
  const frames=laneFrames.filter(safeFrame)
    .sort((a,b)=>a.at-b.at);
  if(frames.length<5)return null;
  // Retain nearby samples for stable grouping when within ~30 metres of
  // the widening. Do not drop the whole lane signal at its most useful time.
  const future=frames.filter(f=>f.at>=progress-155&&
    f.at<=progress+horizonMeters);
  const candidates=[];
  const seen=new Set();
  for(let i=0;i<future.length;i++){
    const pre=groupAt(future,i);
    if(!pre||pre.n<3)continue;
    const key=Math.round(pre.at/12)+'/'+pre.n+'/'+pre.road;
    if(seen.has(key))continue;seen.add(key);
    for(let j=i+1;j<future.length;j++){
      const post=groupAt(future,j);
      if(!post||post.n!==pre.n-1||post.direction!==pre.direction)
        continue;
      const gap=post.at-pre.at;
      if(gap<18||gap>155||post.at<progress+10||
        pre.at<progress-150)continue;
      const mapping=continuity(pre,post);
      if(!mapping)continue;
      const drop=[...Array(pre.n).keys()].filter(i=>
        !mapping.indices.includes(i));
      if(drop.length!==1)continue;
      // Only the OUTER lane may peel away at a fork. A missing centre
      // lane usually means noisy OSM polygon ordering, not a safe prediction.
      if(drop[0]!==0&&drop[0]!==pre.n-1)continue;
      const nextGap=Number.isFinite(nextTurnOffset)
        ?nextTurnOffset-post.at:Infinity;
      const nextSide=nextGap>=20&&nextGap<=370
        ?nextTurnDirection:null;
      const ideal=nextSide==='left'?0:nextSide==='right'
        ?pre.n-1:(pre.n-1)/2;
      const selected=[...mapping.indices].sort((a,b)=>
        Math.abs(a-ideal)-Math.abs(b-ideal)||a-b)[0];
      // Before a third lane actually starts, Cruise must NOT display three
      // current lane ovals. Map back to a stable 2-lane upstream section
      // where possible; only reveal the 3-lane diagram near the widening.
      let shownCount=pre.n,shownSelected=selected,shownDrop=drop,
        anticipatedWidening=null;
      if(pre.at-progress>42){
        const prior=frames.filter(f=>f.at>=pre.at-165&&
          f.at<=pre.at-23&&f.laneCount===pre.n-1&&
          f.direction===pre.direction)
          .map(f=>groupAt(frames,frames.indexOf(f)))
          .filter(Boolean).sort((a,b)=>b.at-a.at)[0];
        const fromTwo=prior?continuity(pre,prior):null;
        if(fromTwo&&fromTwo.indices.includes(selected)){
          shownCount=prior.n;
          shownSelected=fromTwo.indices.indexOf(selected);
          shownDrop=[];
          anticipatedWidening=pre.n;
        }
      }
      candidates.push({
        source:'glide',status:'inferred',kind:'cruise',mode:'continuity',
        laneCount:shownCount,selected:[shownSelected],
        allowedThrough:shownCount===pre.n?mapping.indices:[shownSelected],
        nonContinuing:shownDrop,upcomingLaneCount:anticipatedWidening,
        distanceToJunction:post.at-progress,
        wideningDistanceMeters:pre.at-progress,
        reason:'Repeated mapped cross-sections show a lane does not continue on the routed carriageway',
        offset:pre.at,confidence:'provisional'
      });
      break;
    }
  }
  return candidates.sort((a,b)=>a.distanceToJunction-b.distanceToJunction)[0]||null;
}

// Do not manufacture a "preferred" lane from width alone. Still tell the
// driver when a stable multi-lane section is approaching / already present,
// so Cruise wakes up when a new lane opens after a one-lane stretch.
export function cruiseFromAvailableLanes({
  laneFrames=[],progress=0,horizonMeters=260
}={}){
  if(!Array.isArray(laneFrames)||!Number.isFinite(progress))return null;
  const valid=laneFrames.filter(safeFrame).sort((a,b)=>a.at-b.at);
  for(const f of valid){
    if(f.at<progress-10||f.at>progress+horizonMeters)continue;
    const nearby=valid.filter(p=>p.laneCount===f.laneCount&&
      p.road===f.road&&p.direction===f.direction&&
      Math.abs(p.at-f.at)<=17&&p.offsets.every((v,i)=>
        Math.abs(v-f.offsets[i])<=1.25));
    if(nearby.length<3||Math.max(...nearby.map(p=>p.at))-
      Math.min(...nearby.map(p=>p.at))<8)continue;
    return {source:'glide',status:'inferred',kind:'cruise',
      mode:'available',laneCount:f.laneCount,selected:[],
      distanceToJunction:Math.max(0,f.at-progress),
      reason:'Stable mapped lane group; no supported lane preference'};
  }
  return null;
}
