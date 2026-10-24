// On-demand, one-shot OpenStreetMap lane-tag lookup for an explicitly
// calculated journey. Deliberately NO map movement / playback network calls.
// Public Overpass is a shared service, not a guaranteed high-availability API.
import { approachSamples } from './osm-lane-geometry.js';

const ENDPOINT='https://overpass-api.de/api/interpreter';
const CACHE_MS=20*60*1000;
const ERROR_CACHE_MS=2*60*1000;
const MIN_QUERY_INTERVAL_MS=30*1000;
const MAX_SAMPLES=16;
const MAX_ELEMENTS=700;
const cache=new Map();
let lastNetworkCall=0;

export function routeLaneQuery(route) {
  const instructions=route?.properties?.guidance?.instructions;
  if(!Array.isArray(instructions))return null;
  const all=[];
  for (const instruction of instructions) {
    const item=approachSamples(route,instruction);
    if(!item)continue;
    const coords=item.anchor;
    // Nearby maneuvers share the same Overpass neighborhood.
    if(all.some(old=>Math.hypot((old[0]-coords[0])*80000,
       (old[1]-coords[1])*111000)<120))continue;
    all.push(coords);
  }
  if(!all.length)return null;
  const steps=all.slice(0,MAX_SAMPLES).map(([lon,lat])=>{
    const around='(around:115,'+lat.toFixed(6)+','+lon.toFixed(6)+')';
    return 'way'+around+'["highway"][~"^turn:lanes(:forward|:backward)?$"~"."];';
  });
  return '[out:json][timeout:12];('+steps.join('')+');out geom;';
}
export async function fetchOsmLaneWays(route,routeId) {
  const now=Date.now();
  const cached=cache.get(routeId);
  if(cached && now-cached.at < (cached.error?ERROR_CACHE_MS:CACHE_MS))return cached.result;
  const query=routeLaneQuery(route);
  if(!query)return {status:'no-maneuvers',ways:[],checked:0};
  const checked=(query.match(/way\(around:/g)||[]).length;
  if(now-lastNetworkCall<MIN_QUERY_INTERVAL_MS)
    return {status:'rate-limited',ways:[],checked};
  lastNetworkCall=now;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),14000);
  let result;
  try {
    const response=await fetch(ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:'data='+encodeURIComponent(query),
      signal:controller.signal
    });
    if(!response.ok)throw Error('OSM query returned HTTP '+response.status);
    const data=await response.json();
    if(!Array.isArray(data.elements))throw Error('Unexpected OSM response');
    const ways=data.elements.filter(x=>x.type==='way'&&Array.isArray(x.geometry)&&
       x.tags && Number.isSafeInteger(x.id)).slice(0,MAX_ELEMENTS);
    result={status:'ready',ways,checked};
  } catch(err) {
    result={status:'unavailable',ways:[],checked,reason:
      err?.name==='AbortError'?'OSM lookup timed out':'OSM data service unavailable'};
  } finally {clearTimeout(timer);}
  cache.set(routeId,{at:Date.now(),error:result.status==='unavailable',result});
  if(cache.size>8)cache.delete(cache.keys().next().value);
  return result;
}
