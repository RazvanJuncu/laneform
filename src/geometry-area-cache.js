// Session memory + bounded, on-device IndexedDB cache for *successfully
// reconstructed* OSM XML areas. Never stores routes, API keys, or user profile.
// Area coordinates remain local to the browser and are never exported.
const DB_NAME='glide-geometry-cache-v1';
const STORE='areas';
export const GEOMETRY_CACHE_TTL_MS=7*24*60*60*1000;
export const GEOMETRY_CACHE_MAX_BYTES=12*1024*1024;
export const GEOMETRY_CACHE_MAX_ENTRIES=40;
const MAX_SINGLE_XML=3_000_000;

export function geometryAreaKey(center,radiusMeters=135){
  if(!Array.isArray(center)||center.length!==2||
     !center.every(Number.isFinite)||Math.abs(center[0])>180||
     Math.abs(center[1])>85)throw Error('Invalid geometry cache coordinate');
  const radius=Math.max(80,Math.min(190,radiusMeters));
  // Millimetre precision is unnecessary: roughly one metre per 1e-5 degree.
  // Reuse deliberately the same sampled area; never merge neighbouring areas.
  return 'v1:'+center[0].toFixed(5)+':'+center[1].toFixed(5)+
    ':'+radius.toFixed(0);
}

export function createGeometryAreaCache({
  storage=typeof indexedDB==='undefined'?null:indexedDB,
  now=()=>Date.now(),ttlMs=GEOMETRY_CACHE_TTL_MS,
  maxBytes=GEOMETRY_CACHE_MAX_BYTES,maxEntries=GEOMETRY_CACHE_MAX_ENTRIES
}={}){
  const items=new Map();
  let ready=false,db=null,hits=0,writes=0;
  function valid(row){
    return row&&typeof row.key==='string'&&
      typeof row.xml==='string'&&row.xml.length<MAX_SINGLE_XML&&
      Number.isFinite(row.at)&&now()-row.at>=0&&now()-row.at<ttlMs;
  }
  function trim(){
    const entries=[...items.values()].sort((a,b)=>a.at-b.at);
    let bytes=entries.reduce((n,item)=>n+item.bytes,0);
    const removed=[];
    while(entries.length>maxEntries||bytes>maxBytes){
      const item=entries.shift();
      if(!item)break;
      items.delete(item.key);bytes-=item.bytes;removed.push(item.key);
    }
    return removed;
  }
  function persist(row,removed=[]){
    if(!db)return;
    try{
      const tx=db.transaction(STORE,'readwrite');
      if(row)tx.objectStore(STORE).put(row);
      for(const key of removed)tx.objectStore(STORE).delete(key);
    }catch{ /* Storage is optional. Continue with in-memory cache. */ }
  }
  let resolveReady;
  const boot=new Promise(resolve=>{resolveReady=resolve;});
  function finish(){ready=true;resolveReady();}
  if(!storage){finish();}
  else{
    try{
      const request=storage.open(DB_NAME,1);
      request.onupgradeneeded=()=>{
        const database=request.result;
        if(!database.objectStoreNames.contains(STORE))
          database.createObjectStore(STORE,{keyPath:'key'});
      };
      request.onerror=finish;
      request.onblocked=finish;
      request.onsuccess=()=>{
        db=request.result;
        try{
          const read=db.transaction(STORE,'readonly').objectStore(STORE).getAll();
          read.onsuccess=()=>{
            for(const row of read.result||[]){
              if(valid(row)){
                // Recompute byte estimates rather than trusting stored metadata.
                items.set(row.key,{...row,bytes:row.xml.length*2});
              }
            }
            const removed=trim();
            if(removed.length)persist(null,removed);
            finish();
          };
          read.onerror=finish;
        }catch{finish();}
      };
    }catch{finish();}
  }
  function get(center,radius){
    if(!ready)return null;
    const key=geometryAreaKey(center,radius);
    const value=items.get(key);
    if(!value)return null;
    if(!valid(value)){
      items.delete(key);persist(null,[key]);return null;
    }
    hits++;
    return value.xml;
  }
  function put(center,radius,xml){
    if(!ready||typeof xml!=='string'||xml.length>=MAX_SINGLE_XML)
      return false;
    const key=geometryAreaKey(center,radius);
    const row={key,xml,at:now(),bytes:xml.length*2};
    items.set(key,row);
    const removed=trim();
    if(items.has(key)){persist(row,removed);writes++;return true;}
    persist(null,removed);return false;
  }
  function remove(center,radius){
    if(!ready)return;
    const key=geometryAreaKey(center,radius);
    items.delete(key);persist(null,[key]);
  }
  const stats=()=>({ready,entries:items.size,hits,writes,
    bytes:[...items.values()].reduce((n,x)=>n+x.bytes,0),
    persistent:!!db});
  return {ready:()=>boot,isReady:()=>ready,get,has:(center,radius)=>
    ready&&items.has(geometryAreaKey(center,radius))&&
    valid(items.get(geometryAreaKey(center,radius))),
    put,remove,stats};
}
