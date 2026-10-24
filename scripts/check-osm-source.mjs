import assert from 'node:assert/strict';
import {routeLaneQuery, requestOverpassLaneWays}
  from '../src/osm-lane-source.js';

const road={
  geometry:{type:'LineString',coordinates:[
    [26.04,44.44],[26.045,44.445],[26.051,44.442]
  ]},
  properties:{guidance:{instructions:[]}}
};
const query=routeLaneQuery(road);
assert.ok(query.startsWith('[out:json][timeout:16];'));
assert.equal((query.match(/way\(around:/g)||[]).length,1,
  'Use ONE continuous corridor filter instead of overlapping neighborhood scans');
assert.ok(query.includes('out geom;'));
assert.ok(query.includes('turn:lanes'));
assert.ok(query.length<1300,'Bound public Overpass query size');
assert.ok(query.includes('44.4'),'Keep geographic coordinates in the query');

const sources=[
  {name:'first',url:'https://test.example/primary'},
  {name:'fallback',url:'https://test.example/fallback'}
];
const sample={
  type:'way',id:1024,tags:{highway:'primary','turn:lanes':'left|through'},
  geometry:[{lat:44.4,lon:26.1},{lat:44.41,lon:26.11}]
};
let calls=[];
const success=await requestOverpassLaneWays(query,{
  endpoints:sources,timeoutMs:2000,
  fetchImpl:async(url,options)=>{
    calls.push({url,options});
    return {ok:true,status:200,json:async()=>({elements:[sample]})};
  }
});
assert.equal(success.status,'ready');
assert.equal(success.ways.length,1);
assert.equal(success.source,'first');
assert.equal(calls.length,1);
assert.equal(calls[0].options.method,'POST');
assert.equal(calls[0].options.credentials,'omit');
assert.ok(calls[0].options.body.startsWith('data='));

calls=[];
const fallback=await requestOverpassLaneWays(query,{
  endpoints:sources,timeoutMs:2000,
  fetchImpl:async(url)=>{
    calls.push(url);
    if(url===sources[0].url)throw TypeError('network unavailable');
    return {ok:true,status:200,json:async()=>({elements:[sample]})};
  }
});
assert.equal(fallback.status,'ready');
assert.equal(fallback.source,'fallback');
assert.equal(calls.length,2,'A transient network error may try one alternate host');

calls=[];
const limit=await requestOverpassLaneWays(query,{
  endpoints:sources,timeoutMs:2000,
  fetchImpl:async(url)=>{
    calls.push(url);
    return {ok:false,status:429};
  }
});
assert.equal(limit.status,'unavailable');
assert.equal(limit.errorKind,'rate-limit');
assert.equal(calls.length,1,'429 must NOT bypass the server quota through a second host');

calls=[];
const invalid=await requestOverpassLaneWays(query,{
  endpoints:sources,timeoutMs:2000,
  fetchImpl:async(url)=>{
    calls.push(url);
    return {ok:false,status:400};
  }
});
assert.equal(invalid.errorKind,'invalid-query');
assert.equal(calls.length,1,'Malformed requests must NOT be retried on other servers');

calls=[];
const busy=await requestOverpassLaneWays(query,{
  endpoints:sources,timeoutMs:2000,
  fetchImpl:async(url)=>{
    calls.push(url);
    return url===sources[0].url
      ? {ok:false,status:503}
      : {ok:true,status:200,json:async()=>({elements:[]})};
  }
});
assert.equal(busy.status,'ready');
assert.equal(busy.wayCount,0);
assert.equal(calls.length,2);
assert.deepEqual(busy.ways,[],'Zero results is a successful scan, not a network failure');

console.log('Glide OSM corridor query, provider fallback and diagnostic tests passed.');
