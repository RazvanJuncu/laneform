// Sample real osm2streets driving-lane polygons along a provider route.
// This is a route-context visualization, not verified legal lane guidance.
// Unlike maneuver-pair planning, it also works when TomTom does not report
// an instruction at an ordinary straight-through intersection.
import {routeProfile,positionAtDistance} from './osm-lane-geometry.js';
import {expectedLaneTurn} from './lane-path-candidates.js';

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
function crossSection(point,tangent,segments){
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
  return centers;
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
  const t=selectedTurn(instruction,lookahead,d);
  return sideOf(t)||null;
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
    // A mapped turn-only arrow contrary to the routed movement excludes it.
    const legal=group.filter(c=>!turn || !c.turns.length||c.turns.includes(turn));
    if(!legal.length)return null;
    legal.sort((a,b)=>a.offset-b.offset); // driver's right -> left
    const byIndex=[...legal].sort((a,b)=>a.direction==='Backward'
      ?b.index-a.index:a.index-b.index);
    const chosen=prefer==='left'?byIndex[0]
      :prefer==='right'?byIndex[byIndex.length-1]
      :legal[0];
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
    return {chosen,score};
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
  const result={status:'unavailable',path:empty(),coverage:[],samples:0,
    reason:'No suitable reconstructed driving lane sections'};
  const profile=routeProfile(route),total=route?.properties?.summary?.lengthInMeters;
  if(profile.length<25||!Number.isFinite(total)||total<=0||
    !Number.isFinite(offset)||!Array.isArray(lanes))return result;
  const scale=profile.length/total;
  const from=Math.max(0,(offset-radius)*scale);
  const until=Math.min(profile.length,(offset+radius)*scale);
  if(until-from<12)return result;
  const driving=lanes.flatMap(feature=>{
    const p=feature?.properties||{};
    if(String(p.type).toLowerCase()!=='driving'||
      !Number.isInteger(p.road)||!Number.isInteger(p.index)||
      !['Forward','Backward'].includes(p.direction))return [];
    const edges=ringSegments(feature);
    return edges.length<3?[]:[{
      feature,edges,road:p.road,index:p.index,direction:p.direction,
      turns:Array.isArray(p.allowed_turns)
        ?p.allowed_turns.map(t=>String(t).toLowerCase()):[]
    }];
  });
  if(!driving.length)return result;
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
      for(const c of crossSection(p,tangent,f.edges)){
        candidates.push({...c,road:f.road,index:f.index,
          direction:f.direction,turns:f.turns});
      }
    }
    const match=choice(candidates,prev,prefer,turn);
    if(match){
      sampled.push({d,point:match.point,road:match.road,
        direction:match.direction,index:match.index});
      prev=match;
    }else{
      sampled.push(null);
      // Don't keep directional group indefinitely through missing map data.
      if(sampled.slice(-6).every(s=>!s))prev=null;
    }
  }
  const pieces=[];let active=[];
  function close(){if(active.length>=3)pieces.push(active);active=[];}
  for(let i=0;i<sampled.length;i++){
    const s=sampled[i];
    if(!s)continue;
    if(!active.length){active=[s];continue;}
    const last=active.at(-1),gap=s.d-last.d;
    if(gap>37){close();active=[s];continue;}
    const leap=dist(last.point,s.point);
    if(leap>gap*1.6+3){close();active=[s];continue;}
    if(gap>SAMPLE*1.5){
      const previous=active.length>1?active.at(-2).point:null;
      const following=sampled.slice(i+1).find(x=>x)?.point;
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
  const features=[],coverage=[];
  for(const part of pieces){
    const beginning=part[0].d/scale,ending=part.at(-1).d/scale;
    if(ending-beginning<12)continue;
    features.push({type:'Feature',geometry:{type:'LineString',
      coordinates:part.map(p=>p.point)},properties:{
      status:'inferred-lane-corridor',verified:false,
      description:'Reconstructed driving-lane trajectory, not validated guidance'
    }});
    coverage.push([beginning,ending]);
  }
  if(!features.length)return result;
  return {status:'provisional',path:{type:'FeatureCollection',features},
    coverage,samples:features.reduce((n,f)=>n+f.geometry.coordinates.length,0),
    reason:'Driving-lane cross sections and local trajectory lookahead'};
}
