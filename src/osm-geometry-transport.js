// Bounded, source-aware OSM geometry transport. Public Overpass is best
// effort. Fail over on the NEXT scheduled scan, never make a burst of retries.
import {smallAreaOverpassQuery,MAX_OSM_BYTES,validateOsmXML}
  from './street-geometry-adapter.js';

export const GEOMETRY_ENDPOINTS=Object.freeze([
  {name:'Private.coffee',url:'https://overpass.private.coffee/api/interpreter'},
  {name:'OSM Germany',url:'https://overpass-api.de/api/interpreter'}
]);

function transportError(kind,message){
  return Object.assign(new Error(message),{kind});
}

export function createOsmGeometryTransport({
  endpoints=GEOMETRY_ENDPOINTS,fetchImpl=fetch,
  now=()=>Date.now(),timeoutMs=20000,
  failureBackoffMs=120000,rateLimitBackoffMs=180000
}={}){
  if(!Array.isArray(endpoints)||!endpoints.length)
    throw Error('At least one OSM geometry source is required');
  let preferred=0,consecutiveFailures=0,pausedUntil=0;
  let lastError=null,successfulRequests=0,failedRequests=0;
  const waitMs=()=>Math.max(0,pausedUntil-now());
  const health=()=>({
    source:endpoints[preferred].name,consecutiveFailures,
    pauseRemainingMs:waitMs(),lastError,
    successfulRequests,failedRequests
  });
  async function download(center,radiusMeters=135){
    if(waitMs()>0)throw transportError('backoff',
      'OSM sources resting after errors; retry later');
    const source=endpoints[preferred];
    const aborter=new AbortController();
    const timer=setTimeout(()=>aborter.abort(),timeoutMs);
    try{
      const query=smallAreaOverpassQuery(center,radiusMeters);
      const response=await fetchImpl(source.url,{
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:'data='+encodeURIComponent(query),
        signal:aborter.signal,credentials:'omit',referrerPolicy:'origin'
      });
      if(!response.ok){
        const status=response.status;
        const kind=status===429?'rate-limit':status===400?'bad-query':
          status===502||status===503||status===504?'server-unavailable':'http-error';
        throw transportError(kind,'OSM '+source.name+' HTTP '+status);
      }
      const bytes=Number(response.headers?.get?.('content-length'));
      if(Number.isFinite(bytes)&&bytes>MAX_OSM_BYTES)
        throw transportError('too-large','OSM geometry exceeds size limit');
      const xml=await response.text();
      if(/<remark\b|<error\b/i.test(xml.slice(0,1600)))
        throw transportError('server-unavailable','OSM '+source.name+
          ' rejected or timed out the query');
      validateOsmXML(xml);
      consecutiveFailures=0;pausedUntil=0;lastError=null;
      successfulRequests++;
      return xml;
    }catch(error){
      failedRequests++;
      const kind=error?.kind||
        (aborter.signal.aborted?'timeout':'network');
      const message=kind==='timeout'
        ?'OSM '+source.name+' timed out after '+Math.ceil(timeoutMs/1000)+'s'
        :error?.kind?error.message:'OSM '+source.name+' network request failed';
      lastError=message;
      if(kind==='rate-limit'){
        // Switching public servers to bypass a quota is not acceptable.
        pausedUntil=Math.max(pausedUntil,now()+rateLimitBackoffMs);
      }else if(kind==='server-unavailable'||kind==='timeout'||kind==='network'){
        consecutiveFailures++;
        // Switch only for the NEXT pre-existing 30s scanner slot.
        if(endpoints.length>1)preferred=(preferred+1)%endpoints.length;
        if(consecutiveFailures>=2){
          const factor=Math.min(3,consecutiveFailures-1);
          pausedUntil=Math.max(pausedUntil,now()+failureBackoffMs*factor);
        }
      }else{
        // Invalid queries/responses should not be repeated endlessly.
        pausedUntil=Math.max(pausedUntil,now()+rateLimitBackoffMs);
      }
      throw transportError(kind,message);
    }finally{clearTimeout(timer);}
  }
  return {download,waitMs,health};
}
