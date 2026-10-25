import assert from 'node:assert/strict';
import {localRouteWindow,partitionJunctionGeometry,segmentDistanceMeters}
 from '../src/junction-focus.js';

const route={
 geometry:{type:'LineString',coordinates:[
  [26.0000,44.0000],[26.0040,44.0000],
  [26.0080,44.0000],[26.0080,44.0030]
 ]},
 properties:{summary:{lengthInMeters:900}}
};
function rectangle(id,lon,lat,width=.00017,height=.000035){
 return {type:'Feature',properties:{id},
  geometry:{type:'Polygon',coordinates:[[
   [lon-width/2,lat-height/2],[lon+width/2,lat-height/2],
   [lon+width/2,lat+height/2],[lon-width/2,lat+height/2],
   [lon-width/2,lat-height/2]
  ]]}}
};
function mark(id,from,to){
 return {type:'Feature',properties:{id},
  geometry:{type:'LineString',coordinates:[from,to]}}
}
const routeNear=rectangle('selected-approach',26.0052,44.00003);
const anotherLane=rectangle('selected-adjacent',26.0058,44.00010);
const offRouteArm=rectangle('unrelated-arm',26.0052,44.00048);
const earlierRoad=rectangle('far-behind',26.0005,44.00002);
const data={
 lanes:{type:'FeatureCollection',features:[
   routeNear,anotherLane,offRouteArm,earlierRoad
 ]},
 markings:{type:'FeatureCollection',features:[
   mark('route-arrow',[26.0051,44.000035],[26.0054,44.000035]),
   mark('cross-arm-arrow',[26.0051,44.0005],[26.0054,44.0005]),
   rectangle('painted-arrow-polygon',26.0055,44.00005,.00006,.00004)
 ]}
};
const target=900*(.0055/.011); // matches the route's short eastbound approach
const window=localRouteWindow(route,target);
assert.ok(window.length>=2 && window[0][0]<26.0055);
assert.ok(segmentDistanceMeters([26.0053,44.00004],window[0],window[1])<15);
const result=partitionJunctionGeometry(data,route,target);
assert.equal(result.summary.method,'route-proximity');
assert.ok(result.summary.evidence.includes('not lane-to-lane connectivity'));
assert.equal(result.summary.matchedCount,2);
assert.deepEqual(result.focus.features.map(f=>f.properties.id),
 ['selected-approach','selected-adjacent']);
assert.deepEqual(result.context.features.map(f=>f.properties.id),
 ['unrelated-arm','far-behind']);
assert.deepEqual(result.markings.features.map(f=>f.properties.id),
 ['route-arrow','painted-arrow-polygon']);
assert.equal(result.summary.markingCount,2);
assert.equal(result.summary.supported,true);
assert.deepEqual(data.lanes.features.map(f=>f.properties.id),
 ['selected-approach','selected-adjacent','unrelated-arm','far-behind'],
 'Classification may not mutate source geometry');

const noRoute=partitionJunctionGeometry(data,null,200);
assert.equal(noRoute.focus.features.length,0,
 'Never invent route alignment when the route is missing');
assert.equal(noRoute.summary.supported,false);
assert.equal(noRoute.context.features.length,4);

const empty=partitionJunctionGeometry({lanes:{type:'FeatureCollection',
 features:[]}},route,target);
assert.equal(empty.summary.matchedCount,0);
assert.deepEqual(empty.focus.features,[]);
console.log('Glide route-proximity focus and unverified-alignment safeguards passed.');
