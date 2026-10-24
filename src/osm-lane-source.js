// Glide / OpenStreetMap lane evidence.
// One on-demand corridor scan per deliberately calculated route. Never polls.
// Public Overpass is best-effort and is not suitable for production traffic.
import { routeProfile, positionAtDistance } from './osm-lane-geometry.js';

export const OVERPASS_ENDPOINTS=Object.freeze([
  {name:'Private.coffee',url:'https://overpass.private.coffee/api/interpreter'},
  {name:'OSM Germany',url:'https://overpass-api.de/api/interpreter'}
]);
const CACHE_MS=20*60*1000;
const ERROR_CACHE_MS=2*60*1000;
const MIN_QUERY_INTERVAL_MS=30*1000;
const CORRIDOR_WINDOW_METERS=3700;
const SAMPLE_INTERVAL_METERS=185;
const RADIUS_METERS=120;
const MAX_POINTS=24;
const MAX_ELEMENTS=700;
const MAX_RESPONSE_ELEMENTS=900;
const cache=new Map();
const inflight=new Map();
let lastNetworkCall=0;

function routeCorridor(route){
  const profile=routeProfile(route);
  if(profile.length<40)return null;
  const end=Math.min(profile.length,CORRIDOR_WINDOW_METERS);
  const points=[];
  for(let d=15;d<end && points.length<MAX_POINTS-1;d+=SAMPLE_INTERVAL_METERS){
    const p=positionAtDistance(profile,d);
    if(p && Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
       Math.abs(p[1])<=90 && Math.abs(p[0])<=180)points.push(p);
  }
  const last=positionAtDistance(profile,end);
  if(last && last.every(Number.isFinite))points.push(last);
  if(points.length<2)return null;
  return {points,coverageMeters:end};
}
// Overpass QL supports an around filter on a SINGLE linestring composed of
// lat/lon pairs. This avoids the previous 20 overlapping around-way queries.
export function routeLaneQuery(route){
  const corridor=routeCorridor(route);
  if(!corridor)return null;
  const polyline=corridor.points.map(([lon,lat])=>
    lat.toFixed(6)+','+lon.toFixed(6)).join(',');
  return '[out:json][timeout:16];'+
    'way(around:'+RADIUS_METERS+','+polyline+')'+
    '["highway"][~"^turn:lanes(:forward|:backward)?$"~"."];out geom;';
}
export const laneLookupWindowMeters=CORRIDOR_WINDOW_METERS;

function makeError(kind,message,retryable=false){
  return Object.assign(new Error(message),{kind,retryable});
}
async function queryOverpass(url,query,fetchImpl,timeoutMs){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    // Form-urlencoded POST is CORS-simple and does not require preflight.
    const response=await fetchImpl(url,{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:'data='+encodeURIComponent(query),
      credentials:'omit',signal:controller.signal
    });
    if(!response.ok){
      const status=response.status;
      throw makeError(status===429?'rate-limit':
        status===400?'invalid-query':'http-'+status,
        'HTTP '+status,
        [502,503,504].includes(status));
    }
    const data=await response.json();
    if(!Array.isArray(data?.elements))
      throw makeError('invalid-response','Unexpected Overpass response');
    if(data.remark){
      const remark=String(data.remark).slice(0,160);
      throw makeError('server-error',remark,/timeout|timed out|busy|load/i.test(remark));
    }
    return data.elements;
  } catch(error){
    if(error?.kind)throw error;
    if(error?.name==='AbortError')
      throw makeError('timeout','The OSM server did not respond in time',true);
    // Browser network, TLS, DNS and CORS errors generally surface as TypeError.
    throw makeError('network','Could not reach the OSM server',true);
  } finally {clearTimeout(timer);}
}
// Exported for offline regression tests with fake fetch. Exactly one alternate
// public endpoint is attempted for transient failures; 429/400 NEVER fail over.
export async function requestOverpassLaneWays(query,{
  fetchImpl=fetch,endpoints=OVERPASS_ENDPOINTS,timeoutMs=19000
}={}){
  let lastError=null;
  for(const endpoint of endpoints.slice(0,2)){
    try {
      const elements=await queryOverpass(endpoint.url,query,fetchImpl,timeoutMs);
      if(elements.length>MAX_RESPONSE_ELEMENTS)
        return {status:'too-large',ways:[],source:endpoint.name,
          reason:'OSM response exceeded the safe scan limit'};
      const ways=elements.filter(x=>x.type==='way' &&
        Array.isArray(x.geometry) && x.tags && Number.isSafeInteger(x.id));
      if(ways.length>MAX_ELEMENTS)
        return {status:'too-large',ways:[],source:endpoint.name,
          reason:'Too many OSM lane-marked roads for a safe scan'};
      return {status:'ready',ways,source:endpoint.name,wayCount:ways.length};
    } catch(error){
      lastError=error;
      if(!error.retryable)break;
    }
  }
  return {status:'unavailable',ways:[],errorKind:lastError?.kind||'unknown',
    reason:lastError?.message||'OSM service unavailable'};
}
export async function fetchOsmLaneWays(route,routeId,{force=false}={}){
  const now=Date.now();
  const current=cache.get(routeId);
  if(!force && current && now-current.at <
    (current.error?ERROR_CACHE_MS:CACHE_MS))return current.result;
  if(inflight.has(routeId))return inflight.get(routeId);

  const corridor=routeCorridor(route);
  if(!corridor)return {status:'no-geometry',ways:[],checked:0,coverageMeters:0};
  if(now-lastNetworkCall<MIN_QUERY_INTERVAL_MS){
    return {status:'rate-limited',ways:[],checked:0,coverageMeters:0,
      retryAfterSeconds:Math.ceil((MIN_QUERY_INTERVAL_MS-(now-lastNetworkCall))/1000),
      reason:'Lane lookup cooldown active'};
  }
  const query=routeLaneQuery(route);
  if(!query)return {status:'no-geometry',ways:[],checked:0,coverageMeters:0};
  lastNetworkCall=now;
  const work=(async()=>{
    const result=await requestOverpassLaneWays(query);
    const augmented={...result,checked:corridor.points.length,
      coverageMeters:result.status==='ready'?corridor.coverageMeters:0,
      requestedMeters:corridor.coverageMeters};
    cache.set(routeId,{at:Date.now(),error:result.status!=='ready',result:augmented});
    if(cache.size>8)cache.delete(cache.keys().next().value);
    return augmented;
  })();
  inflight.set(routeId,work);
  try{return await work;}
  finally{inflight.delete(routeId);}
}
