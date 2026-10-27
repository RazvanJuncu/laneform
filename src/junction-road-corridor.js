// Sample real osm2streets driving-lane polygons along a provider route.
// This is a route-context visualization, not verified legal lane guidance.
// Unlike maneuver-pair planning, it also works when TomTom does not report
// an instruction at an ordinary straight-through intersection.
import {routeProfile,positionAtDistance} from './osm-lane-geometry.js';
import {expectedLaneTurn} from './lane-path-candidates.js';
import {smoothMappedTurn} from './junction-turn-connector.js';

const RAD=Math.PI/180;
const SAMPLE=5;
const CAST=21;
const MAX_LATERAL=16;
const empty=()=>({type:'FeatureCollection',features:[]});
const valid=p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1]);
const sideOf=t=>/left/.test(t||'')?'left':/right/.test(t||'')?'right':null;
const toMeters=(a,b)=>{
  const cos=Math.max(.1,Math.cos((a[1]+b[1])*.5*RAD));
  return [(b[0]-a[0])*111320*cos,(b[1]-a[1])*110540];
};
const dist=(a,b)=>Math.hypot(...toMeters(a,b));
function ringSegments(feature){
  const g=feature?.geometry;
  const polys=g?.type==='Polygon'?[g.coordinates]:
    g?.type==='MultiPolygon'?g.coordinates:[];
  const out=[];
  for(const poly of polys)for(const ring of poly||[]){
    if(!Array.isArray(ring))continue;
    for(let i=1;i<ring.length;i++)if(valid(ring[i-1])&&valid(ring[i]))
      out.push([ring[i-1],ring[i]]);
  }
  return out;
}
function cross(a,b){return a[0]*b[1]-a[1]*b[0];}
function insideRing(point,ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if(!valid(a)||!valid(b))continue;
    if((a[1]>point[1])!==(b[1]>point[1])&&
      point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])
      inside=!inside;
  }
  return inside;
}
function insideFeature(point,feature){
  const g=feature?.geometry;
  const polys=g?.type==='Polygon'?[g.coordinates]:
    g?.type==='MultiPolygon'?g.coordinates:[];
  return polys.some(poly=>{
    if(!Array.isArray(poly)||!poly.length||!insideRing(point,poly[0]))
      return false;
    return !poly.slice(1).some(ring=>insideRing(point,ring));
  });
}
function sampledCrossSection(center,normal,feature){
  // Clipped osm2streets polygons may contain multiple crossing edges at a
  // vertex; point-in-polygon sampling avoids rejecting those narrow lanes.
  const cos=Math.max(.1,Math.cos(center[1]*RAD));
  const step=.45,results=[];
  let start=null;
  for(let d=-CAST;d<=CAST+step;d+=step){
    const point=[center[0]+d*normal[0]/(111320*cos),
      center[1]+d*normal[1]/110540];
    const inside=d<=CAST&&insideFeature(point,feature);
    if(inside&&start===null)start=d;
    else if(!inside&&start!==null){
      const width=d-start,offset=(start+d)/2;
      if(width>=1.45&&width<=7.5&&Math.abs(offset)<=MAX_LATERAL)
        results.push({offset,point:[
          center[0]+offset*normal[0]/(111320*cos),
          center[1]+offset*normal[1]/110540]});
      start=null;
    }
  }
  return results;
}
function crossSection(point,tangent,segments,feature){
  const heading=[tangent[0]*111320*Math.cos(point[1]*RAD),
    tangent[1]*110540];
  const length=Math.hypot(...heading);
  if(length<.15)return [];
  const normal=[-heading[1]/length,heading[0]/length]; // positive = driver's left
  const cos=Math.max(.1,Math.cos(point[1]*RAD));
  const hits=[];
  for(const [a,b] of segments){
    const p=toMeters(point,a),q=toMeters(point,b);
    const edge=[q[0]-p[0],q[1]-p[1]];
    const den=cross(normal,edge);
    if(Math.abs(den)<1e-8)continue;
    const t=cross(p,edge)/den;
    const u=cross(p,normal)/den;
    if(Math.abs(t)<=CAST && u>=-1e-7 && u<=1+1e-7)hits.push(t);
  }
  hits.sort((a,b)=>a-b);
  const dedup=hits.filter((x,i)=>i===0||x-hits[i-1]>.06);
  const centers=[];
  for(let i=0;i+1<dedup.length;i+=2){
    const width=dedup[i+1]-dedup[i];
    const offset=(dedup[i]+dedup[i+1])/2;
    if(width<1.45||width>7.5||Math.abs(offset)>MAX_LATERAL)continue;
    centers.push({
      offset,
      point:[point[0]+offset*normal[0]/(111320*cos),
        point[1]+offset*normal[1]/110540]
    });
  }
  return centers.length?centers:sampledCrossSection(point,normal,feature);
}
function selectedTurn(instruction,lookahead,d){
  const current=expectedLaneTurn(instruction);
  const at=instruction?.routeOffsetInMeters;
  // Just before the current maneuver, explicit arrows are authoritative.
  if(Number.isFinite(at)&&d<at && at-d<100)return current;
  for(const n of lookahead||[]){
    const nd=n?.offset,turn=expectedLaneTurn(n?.instruction);
    if(Number.isFinite(nd)&&nd>d&&nd-d<135&&turn)return turn;
  }
  return null;
}
function laneSide(instruction,lookahead,d){
  const current=sideOf(expectedLaneTurn(instruction));
  const at=instruction?.routeOffsetInMeters;
  // Stay on the selected EXIT side for the full local mapped corridor.
  // The previous 45m cutoff made left-turn routes suddenly jump to the
  // rightmost (or central) lane mid-block when the preference expired.
  // A separate explicit lane-change planner is required to switch sides.
  if(current&&Number.isFinite(at)&&d>=at-130)return current;
  for(const next of lookahead||[]){
    const gap=next?.offset-d,upcoming=sideOf(expectedLaneTurn(next?.instruction));
    if(Number.isFinite(gap)&&gap>0&&gap<=350&&upcoming)return upcoming;
  }
  return null;
}
function laneTypeLabel(p){
  const raw=p.type??p.lane_type??p.laneType??p.lt??null;
  if(typeof raw==='string')return raw.toLowerCase().replace(/[^a-z]/g,'');
  if(raw&&typeof raw==='object')
    return Object.keys(raw).join('').toLowerCase().replace(/[^a-z]/g,'');
  return '';
}
function laneDirection(raw){
  const s=String(raw??'').trim().toLowerCase();
  if(['forward','fwd','forwards','along','with'].includes(s))return 'Forward';
  if(['backward','backwards','bwd','reverse','against'].includes(s))
    return 'Backward';
  return null;
}
function choice(candidates,prev,prefer,turn){
  // The current route direction lies on the right side of a two-way street
  // (right-hand traffic). Group opposite-direction lanes separately.
  const groups=new Map();
  for(const c of candidates){
    const k=c.road+'/'+c.direction;
    if(!groups.has(k))groups.set(k,[]);
    groups.get(k).push(c);
  }
  const groupCenters=[...groups.values()].map(group=>
    group.reduce((s,c)=>s+c.offset,0)/group.length);
  const ranked=[...groups.values()].map(group=>{
    // Without trustworthy travel-direction metadata, only consider mapped
    // driving polygons strictly on the right of the routed centerline.
    // This is conservative for the current right-hand-traffic prototype:
    // oncoming left-side polygons must never be treated as approach lanes.
    const safeGroup=group[0]?.direction==='Inferred'
      ?group.filter(c=>c.offset<-.35):group;
    if(!safeGroup.length)return null;
    // A mapped turn-only arrow contrary to the routed movement excludes it.
    const eligible=safeGroup.filter(c=>
      !turn || !c.turns.length||c.turns.includes(turn));
    // Prefer actual mapped arrows for this movement where they exist.
    const marked=turn?eligible.filter(c=>c.turns.includes(turn)):[];
    const legal=marked.length?marked:eligible;
    if(!legal.length)return null;
    legal.sort((a,b)=>a.offset-b.offset); // driver's right -> left
    const byIndex=[...legal].sort((a,b)=>a.direction==='Backward'
      ?b.index-a.index:a.index-b.index);
    // Preserve the actual mapped lane while traveling along this road.
    // Never replace it with a middle/right lane merely because a maneuver
    // preference is no longer active at some arbitrary distance.
    const same=prev && prev.road===group[0].road &&
      prev.direction===group[0].direction
      ?legal.find(c=>c.index===prev.index):null;
    const chosen=same||(prefer==='left'?byIndex[0]
      :prefer==='right'?byIndex[byIndex.length-1]
      :legal[0]);
    // Record the FULL directional lane group (including noneligible lanes),
    // not just lanes compatible with this turn. These are the same lane
    // coordinates used in the visible trajectory, not TomTom arrow data.
    const allLanes=[...safeGroup].sort((a,b)=>a.direction==='Backward'
      ?b.index-a.index:a.index-b.index);
    const uniqueIndices=[...new Set(allLanes.map(c=>c.index))];
    const laneOrdinal=uniqueIndices.indexOf(chosen.index);
    if(laneOrdinal<0||uniqueIndices.length>9)return null;
    const groupCenter=group.reduce((s,c)=>s+c.offset,0)/group.length;
    // When a right-side lane group is visible but prohibited by an explicit
    // turn arrow, do NOT route through its opposite-direction neighbor.
    if(groupCenter>1.3 && groupCenters.some(x=>x<groupCenter-1.3))
      return null;
    // Prefer the directional carriageway on the route's right-hand side.
    // Penalize switching directional road groups between samples.
    const wrongSide=Math.max(0,groupCenter+.45);
    const continuity=prev && prev.road===chosen.road&&
      prev.direction===chosen.direction ? -14 : 0;
    const leap=prev?Math.max(0,dist(prev.point,chosen.point)-SAMPLE)*.65:0;
    const score=Math.abs(groupCenter)*.28+
      wrongSide*4+Math.max(0,-groupCenter-9)*.6+
      continuity+leap;
    return {chosen:{...chosen,laneCount:uniqueIndices.length,
      laneOrdinal},score};
  }).filter(Boolean).sort((a,b)=>a.score-b.score);
  if(!ranked.length)return null;
  if(ranked.length>1&&!prev&&Math.abs(ranked[1].score-ranked[0].score)<.3)
    return null;
  return ranked[0].chosen;
}
function quadraticBridge(before,a,b,after){
  const span=dist(a,b);
  if(!before||!after||span<.1||span>37)return null;
  const v0=toMeters(before,a),v1=toMeters(b,after);
  const n0=Math.hypot(...v0),n1=Math.hypot(...v1);
  if(n0<.3||n1<.3)return null;
  const pull=Math.min(12,span*.43);
  const c0=[v0[0]/n0*pull,v0[1]/n0*pull];
  const d=toMeters(a,b);
  const c1=[d[0]-v1[0]/n1*pull,d[1]-v1[1]/n1*pull];
  const cos=Math.max(.1,Math.cos(a[1]*RAD));
  const pts=[];
  for(let i=1;i<=8;i++){
    const t=i/9,u=1-t;
    const x=3*u*u*t*c0[0]+3*u*t*t*c1[0]+t*t*t*d[0];
    const y=3*u*u*t*c0[1]+3*u*t*t*c1[1]+t*t*t*d[1];
    pts.push([a[0]+x/(111320*cos),a[1]+y/110540]);
  }
  return pts;
}
function distanceToRoute(p,profile,nearD){
  let min=Infinity;
  for(let d=Math.max(0,nearD-32);d<=Math.min(profile.length,nearD+32);d+=5){
    const q=positionAtDistance(profile,d);
    if(q)min=Math.min(min,dist(p,q));
  }
  return min;
}
/**
 * Generate a lane-centered, rolling local trajectory and precise coverage
 * ranges in route-metres; never assert that the GPS user occupies this lane.
 * The caller must paint this as inferred and keep provider route outside
 * the returned coverage.
 */
export function buildLaneCorridor({route,offset,lanes=[],instruction=null,
  next=[],radius=125}={}){
  const diagnostics={
    inputPolygons:Array.isArray(lanes)?lanes.length:0,
    schemaSamples:Array.isArray(lanes)
      ?lanes.slice(0,12).map(f=>({
        keys:Object.keys(f?.properties||{}),
        type:f?.properties?.type??f?.properties?.lane_type??null,
        direction:f?.properties?.direction??f?.properties?.dir??null,
        road:f?.properties?.road??f?.properties?.road_id??null,
        index:f?.properties?.index??f?.properties?.lane_index??null
      })):[],
    rejected:{type:0,geometry:0,road:0,index:0,direction:0},
    inferredDirectionPolygons:0,eligibleDrivingPolygons:0,crossSections:0,
    matchedSamples:0,continuousSections:0,approachSamples:0,
    turnConnector:'not-required',turnConnectorGap:0
  };
  const result={status:'unavailable',path:empty(),coverage:[],samples:0,
    recommendation:null,diagnostics,
    reason:'No suitable reconstructed driving lane sections'};
  const profile=routeProfile(route),total=route?.properties?.summary?.lengthInMeters;
  if(profile.length<25||!Number.isFinite(total)||total<=0||
    !Number.isFinite(offset)||!Array.isArray(lanes))return result;
  const scale=profile.length/total;
  const from=Math.max(0,(offset-radius)*scale);
  const until=Math.min(profile.length,(offset+radius)*scale);
  if(until-from<12)return result;
  const driving=lanes.flatMap((feature,ordinal)=>{
    const p=feature?.properties||{};
    const label=laneTypeLabel(p);
    // Never use unclassified lane polygons; they may be sidewalks or cycleways.
    if(!['driving','drive','motorvehicle','motorcar','vehicular'].includes(label)){
      diagnostics.rejected.type++;return [];
    }
    const edges=ringSegments(feature);
    if(edges.length<3){diagnostics.rejected.geometry++;return [];}
    let rawRoad=p.road??p.road_id??p.roadId??null;
    if(rawRoad===null&&Array.isArray(p.osm_way_ids)&&p.osm_way_ids.length)
      rawRoad='way:'+String(p.osm_way_ids[0]);
    const knownRoad=(typeof rawRoad==='string'&&rawRoad.length>0&&
      rawRoad.length<=100)||Number.isInteger(rawRoad);
    if(!knownRoad)diagnostics.rejected.road++;
    const road=knownRoad?rawRoad:'unmapped:'+ordinal;
    const rawIndex=p.index??p.lane_index??p.laneIndex;
    const numericIndex=Number(rawIndex);
    const indexed=rawIndex!==undefined&&rawIndex!==null&&
      Number.isInteger(numericIndex)&&numericIndex>=0&&numericIndex<=50;
    if(!indexed)diagnostics.rejected.index++;
    const index=indexed?numericIndex:0;
    const explicitDirection=laneDirection(p.direction??p.dir??p.travel_direction);
    if(!explicitDirection){diagnostics.rejected.direction++;
      diagnostics.inferredDirectionPolygons++;}
    const direction=explicitDirection||'Inferred';
    return [{feature,edges,road,index,direction,
      // A geometry-only inference may be shown on the map, but must never
      // generate a lane-count HUD claim without matching source metadata.
      // The source may omit direction while still providing a usable road ID
      // and lane ordinal. For this right-hand-traffic prototype, the Inferred
      // direction is restricted to the right-hand side in choice(), and all
      // resulting HUD squares stay explicitly labeled 'inferred'.
      hudEligible:knownRoad&&indexed,
      turns:Array.isArray(p.allowed_turns)
        ?p.allowed_turns.map(t=>String(t).toLowerCase()):[]
    }];
  });
  diagnostics.eligibleDrivingPolygons=driving.length;
  if(!driving.length){
    result.reason=lanes.length
      ?'No drivable lane polygons recognized in the osm2streets export'
      :'No reconstructed lane polygons were returned';
    console.warn('Glide lane schema mismatch',diagnostics);
    return result;
  }
  const sampled=[];
  let prev=null;
  for(let d=from;d<=until+.01;d+=SAMPLE){
    const p=positionAtDistance(profile,d);
    const before=positionAtDistance(profile,Math.max(0,d-3));
    const after=positionAtDistance(profile,Math.min(profile.length,d+3));
    if(!p||!before||!after){sampled.push(null);continue;}
    const tangent=[after[0]-before[0],after[1]-before[1]];
    const turn=selectedTurn(instruction,next,d/scale);
    const prefer=laneSide(instruction,next,d/scale);
    const candidates=[];
    for(const f of driving){
      for(const c of crossSection(p,tangent,f.edges,f.feature)){
        candidates.push({...c,road:f.road,index:f.index,
          direction:f.direction,turns:f.turns,
          hudEligible:f.hudEligible});
      }
    }
    diagnostics.crossSections+=candidates.length;
    const match=choice(candidates,prev,prefer,turn);
    if(match && prev && prev.road===match.road &&
        prev.direction===match.direction&&prev.index!==match.index){
      // A lane change needs a longitudinal transition; never draw an
      // instantaneous diagonal between adjacent lane centers.
      sampled.push(null);
      prev=null;
    }else if(match){
      sampled.push({d,point:match.point,road:match.road,
        direction:match.direction,index:match.index,
        laneOrdinal:match.laneOrdinal,laneCount:match.laneCount,
        hudEligible:match.hudEligible});
      prev=match;
      diagnostics.matchedSamples++;
    }else{
      sampled.push(null);
      // Don't keep directional group indefinitely through missing map data.
      if(sampled.slice(-6).every(s=>!s))prev=null;
    }
  }
  // Crucial: near a turn, polygons from several arms overlap. Do not follow
  // raw sample-to-sample road switches through the junction. Connect stable
  // lane centers with one continuous, tangent-aligned cubic curve.
  let smoothed=sampled;
  if(sideOf(expectedLaneTurn(instruction))){
    const result=smoothMappedTurn(sampled,{
      turnDistance:offset*scale,
      routeDistance:(point,d)=>distanceToRoute(point,profile,d)
    });
    smoothed=result.samples;
    diagnostics.turnConnector=result.bridged?'smooth':
      'suppressed-unstable-junction';
    diagnostics.turnConnectorGap=result.gap||0;
  }
  const pieces=[];let active=[];
  function close(){if(active.length>=3)pieces.push(active);active=[];}
  for(let i=0;i<smoothed.length;i++){
    const s=smoothed[i];
    if(!s)continue;
    if(!active.length){active=[s];continue;}
    const last=active.at(-1),gap=s.d-last.d;
    if(gap>37){close();active=[s];continue;}
    const leap=dist(last.point,s.point);
    if(leap>gap*1.6+3){close();active=[s];continue;}
    if(gap>SAMPLE*1.5){
      const previous=active.length>1?active.at(-2).point:null;
      const following=smoothed.slice(i+1).find(x=>x)?.point;
      const bridge=quadraticBridge(previous,last.point,s.point,following);
      if(!bridge || bridge.some(p=>distanceToRoute(p,profile,
        (last.d+s.d)/2)>21)){
        close();active=[s];continue;
      }
      for(let j=0;j<bridge.length;j++)active.push({
        d:last.d+gap*(j+1)/(bridge.length+1),point:bridge[j]});
    }
    active.push(s);
  }
  close();
  diagnostics.continuousSections=pieces.length;
  if(!pieces.length){
    result.reason=diagnostics.crossSections===0
      ?'No driving-lane polygon overlaps the selected route corridor'
      :diagnostics.matchedSamples===0
        ?'Lane sides or turn permissions could not be established'
        :'Lane samples were too fragmented for a continuous trajectory';
    return result;
  }
  const features=[],coverage=[],eligibleApproaches=[];
  for(const part of pieces){
    const beginning=part[0].d/scale,ending=part.at(-1).d/scale;
    if(ending-beginning<12)continue;
    features.push({type:'Feature',geometry:{type:'LineString',
      coordinates:part.map(p=>p.point)},properties:{
      status:'inferred-lane-corridor',verified:false,
      description:'Reconstructed driving-lane trajectory, not validated guidance'
    }});
    coverage.push([beginning,ending]);
    // Only samples actually present in a displayed path can power the HUD.
    // Sample before the maneuver, away from the intersection's turning gap.
    for(const sample of part){
      const at=sample.d/scale;
      if(sample.hudEligible===true&&
        Number.isInteger(sample.laneCount)&&sample.laneCount>=1&&
        Number.isInteger(sample.laneOrdinal)&&
        sample.laneOrdinal>=0&&sample.laneOrdinal<sample.laneCount &&
        at>=offset-165&&at<=offset-8){
        eligibleApproaches.push({...sample,at});
      }
    }
  }
  if(!features.length){
    result.reason='Lane sections shorter than the 12-metre visualization limit';
    return result;
  }
  diagnostics.approachSamples=eligibleApproaches.length;
  // Choose the closest valid upstream lane sample, but don't insist on an
  // arbitrary 55m anchor when the real OSM lane polygon is shorter.
  // It must still lie upstream of the maneuver and be visible on the route.
  eligibleApproaches.sort((a,b)=>
    Math.abs(a.at-(offset-55))-Math.abs(b.at-(offset-55)));
  let first=eligibleApproaches[0]||null;
  // Check neighboring samples for consistency; reject an isolated flip
  // between lanes instead of highlighting a square which would contradict
  // the longer trajectory.
  if(first){
    const peers=eligibleApproaches.filter(p=>
      p.road===first.road&&p.direction===first.direction&&
      Math.abs(p.at-first.at)<=16);
    const agreeing=peers.filter(p=>
      p.laneOrdinal===first.laneOrdinal&&p.laneCount===first.laneCount);
    if(agreeing.length<Math.min(2,peers.length))first=null;
  }
  const recommendation=first
    ?{source:'glide',status:'inferred',laneCount:first.laneCount,
      selected:[first.laneOrdinal],laneIndex:first.index,
      road:first.road,direction:first.direction,
      sampleOffsetMeters:first.at,junctionOffsetMeters:offset}
    :null;
  return {status:'provisional',path:{type:'FeatureCollection',features},
    coverage,recommendation,diagnostics,
    samples:features.reduce((n,f)=>n+f.geometry.coordinates.length,0),
    reason:recommendation
      ?'Lane corridor and upstream lane selection reconstructed'
      :'Trajectory available, but no stable upstream lane for the quick-check'};
}
