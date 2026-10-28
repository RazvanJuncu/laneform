import assert from 'node:assert/strict';
import {createOsmGeometryTransport,GEOMETRY_ENDPOINTS}
  from '../src/osm-geometry-transport.js';
import {smallAreaOverpassQuery} from '../src/street-geometry-adapter.js';

let time=10000,calls=[];
const xml='<osm version="0.6"><node id="1" lat="44.43" lon="26.06"/></osm>';
const sources=[
  {name:'A',url:'https://mock.example/a'},
  {name:'B',url:'https://mock.example/b'}
];
let responses=[502,503,200];
const transport=createOsmGeometryTransport({
  endpoints:sources,now:()=>time,timeoutMs:50,
  failureBackoffMs:1000,rateLimitBackoffMs:3000,
  fetchImpl:async(url,options)=>{
    calls.push({url,options});
    const status=responses.shift();
    return {ok:status===200,status,headers:{get:()=>String(xml.length)},
      text:async()=>xml};
  }
});
const attempt=()=>transport.download([26.06,44.43],135);
await assert.rejects(attempt(),/HTTP 502/);
assert.equal(calls.length,1,'No immediate source rotation or retry');
assert.equal(calls[0].url,sources[0].url);
assert.equal(calls[0].options.method,'POST');
assert.equal(calls[0].options.credentials,'omit');
assert.equal(calls[0].options.referrerPolicy,'origin');
assert.match(decodeURIComponent(calls[0].options.body),/way\["highway"\]/);
assert.equal(transport.health().source,'B');
await assert.rejects(attempt(),/HTTP 503/);
assert.equal(calls.length,2,'Second request is in the NEXT scheduled slot');
assert.equal(calls[1].url,sources[1].url);
assert.equal(transport.health().source,'A');
assert.ok(transport.waitMs()>=1000,'Repeated outages must trigger a pause');
await assert.rejects(attempt(),/resting/);
assert.equal(calls.length,2,'No network requests while paused');
time+=1100;
assert.equal(await attempt(),xml);
assert.equal(calls.length,3);
assert.equal(transport.health().consecutiveFailures,0);
assert.equal(transport.health().pauseRemainingMs,0);

let rateCalls=0;
const rateLimited=createOsmGeometryTransport({
  endpoints:sources,now:()=>time,rateLimitBackoffMs:2000,
  fetchImpl:async()=>{
    rateCalls++;
    return {ok:false,status:429};
  }
});
await assert.rejects(rateLimited.download([26.06,44.43]),/429/);
assert.equal(rateLimited.health().source,'A',
  '429 cannot bypass the quota on another public instance');
assert.equal(rateLimited.waitMs(),2000);
await assert.rejects(rateLimited.download([26.06,44.43]),/resting/);
assert.equal(rateCalls,1);

const query=smallAreaOverpassQuery([26.06,44.43],135);
assert.match(query,/\[out:xml\]/);
assert.match(query,/way\["highway"\]/);
assert.ok(!query.includes('node('),'No unrelated POI nodes');
assert.ok(GEOMETRY_ENDPOINTS.length>=2);
console.log('Glide OSM geometry resilience, no retry storms and HTTP 429 backoff passed.');
