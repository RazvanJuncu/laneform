// On-demand, one-shot OpenStreetMap lane-tag lookup for an explicitly
// calculated journey. Deliberately NO map movement / playback network calls.
// Public Overpass is a shared service, not a guaranteed high-availability API.
import { routeProfile, positionAtDistance } from './osm-lane-geometry.js';

const ENDPOINT='https://overpass-api.de/api/interpreter';
const CACHE_MS=20*60*1000;
const ERROR_CACHE_MS=2*60*1000;
const MIN_QUERY_INTERVAL_MS=30*1000;
const MAX_SAMPLES=20;
const CORRIDOR_WINDOW_METERS=3700;
const SAMPLE_INTERVAL_METERS=185;
const NEIGHBORHOOD_RADIUS_METERS=125;
const MAX_ELEMENTS=700;
const cache=new Map();
let lastNetworkCall=0;

// Sample roads continuously ahead, even at junctions that do not generate
// a TomTom navigation instruction. One bounded lookahead window per planned
// route. Sampling and matching work at arbitrary geographic coordinates.
export function routeLaneQuery(route) {
  const profile=routeProfile(route);
  if(profile.length<40)return null;
  const end=Math.min(profile.length,CORRIDOR_WINDOW_METERS);
  const points=[];
  for(let d=Math.min(75,end/3);d<end && points.length<MAX_SAMPLES;
    d+=SAMPLE_INTERVAL_METERS){
    const p=positionAtDistance(profile,d);
    if(p && p.every(Number.isFinite))points.push(p);
  }
  if(!points.length)return null;
  const steps=points.map(([lon,lat])=>{
    const around='(around:'+NEIGHBORHOOD_RADIUS_METERS+','+
      lat.toFixed(6)+','+lon.toFixed(6)+')';
    return 'way'+around+'["highway"][~"^turn:lanes(:forward|:backward)?$"~"."];';
  });
  return '[out:json][timeout:12];('+steps.join('')+');out geom;';
}
export const laneLookupWindowMeters=CORRIDOR_WINDOW_METERS;
export async function fetchOsmLaneWays(route,routeId) {
  const now=Date.now();
  const cached=cache.get(routeId);
  if(cached && now-cached.at < (cached.error?ERROR_CACHE_MS:CACHE_MS))return cached.result;
  const query=routeLaneQuery(route);
  if(!query)return {status:'no-geometry',ways:[],checked:0,coverageMeters:0};
  const checked=(query.match(/way\(around:/g)||[]).length;
  if(now-lastNetworkCall<MIN_QUERY_INTERVAL_MS)
    return {status:'rate-limited',ways:[],checked,coverageMeters:Math.min(routeProfile(route).length,CORRIDOR_WINDOW_METERS)};
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
    result={status:'ready',ways,checked,coverageMeters:Math.min(routeProfile(route).length,CORRIDOR_WINDOW_METERS)};
  } catch(err) {
    result={status:'unavailable',ways:[],checked,coverageMeters:0,reason:
      err?.name==='AbortError'?'OSM lookup timed out':'OSM data service unavailable'};
  } finally {clearTimeout(timer);}
  cache.set(routeId,{at:Date.now(),error:result.status==='unavailable',result});
  if(cache.size>8)cache.delete(cache.keys().next().value);
  return result;
}
