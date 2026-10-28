import assert from 'node:assert/strict';
import {createGeometryAreaCache,geometryAreaKey}
  from '../src/geometry-area-cache.js';
import {createOsmGeometryTransport}
  from '../src/osm-geometry-transport.js';

let now=10000;
const rows=new Map();
const db={
  objectStoreNames:{contains:name=>name==='areas'},
  createObjectStore(){},
  transaction(){
    return {objectStore:()=>({
      getAll(){
        const request={};
        queueMicrotask(()=>{request.result=[...rows.values()];
          request.onsuccess?.();});
        return request;
      },
      put(row){rows.set(row.key,row);},
      delete(key){rows.delete(key);}
    })};
  }
};
const storage={
  open(){
    const request={result:db};
    queueMicrotask(()=>{
      request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }
};
const a=[26.06123,44.43211],b=[26.0613,44.4322],c=[26.0618,44.4324];
assert.notEqual(geometryAreaKey(a,135),geometryAreaKey(b,135));
assert.equal(geometryAreaKey(a,135),geometryAreaKey([...a],135));
assert.notEqual(geometryAreaKey(a,135),geometryAreaKey(a,190));
const first=createGeometryAreaCache({
  storage,now:()=>now,maxEntries:2,maxBytes:100000,ttlMs:1000
});
await first.ready();
const xml='<osm version="0.6"><way id="42"/></osm>';
assert.equal(first.put(a,135,xml),true);
now+=10;first.put(b,135,xml);
now+=10;first.put(c,135,xml);
assert.equal(first.get(a,135),null,'Oldest cache area evicted');
assert.equal(first.get(b,135),xml);
assert.equal(first.stats().entries,2);
assert.equal(first.stats().persistent,true);
const second=createGeometryAreaCache({
  storage,now:()=>now,maxEntries:2,maxBytes:100000,ttlMs:1000
});
await second.ready();
assert.equal(second.get(b,135),xml,
  'Verified OSM area survives new browser session');
assert.equal(second.get(c,135),xml);
now+=1200;
assert.equal(second.get(b,135),null,'Expired geometry is never reused');
assert.equal(second.stats().hits,2);

let calls=0;
const verified=createGeometryAreaCache({storage:null,now:()=>now});
await verified.ready();
const transport=createOsmGeometryTransport({
  cache:verified,endpoints:[{name:'mock',url:'https://test.example/osm'}],
  now:()=>now,fetchImpl:async()=>{calls++;return {
    ok:true,status:200,headers:{get:()=>String(xml.length)},text:async()=>xml
  };}
});
assert.equal(await transport.download(a,135),xml);
assert.equal(calls,1);
// Persist only after successful parsing/reconstruction by the caller.
assert.equal(transport.hasCached(a,135),false);
transport.storeVerified(a,135,xml);
assert.equal(transport.hasCached(a,135),true);
assert.equal(await transport.download(a,135),xml);
assert.equal(calls,1,'Local hit must cost no extra Overpass request');
transport.invalidate(a,135);
assert.equal(transport.hasCached(a,135),false);
console.log('Glide on-device geometry persistence, TTL, bounds and zero-network hits passed.');
