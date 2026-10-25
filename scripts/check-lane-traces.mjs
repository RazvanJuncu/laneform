import assert from 'node:assert/strict';
import {candidateApproachLanePaths,expectedLaneTurn,normalizeAllowedTurn}
  from '../src/lane-path-candidates.js';
import {baseRoadLayerIds,setStreetBasemapHidden,forgetStreetBasemapStyle}
  from '../src/street-basemap.js';

const style=[
  {id:'background',type:'background'},
  {id:'water',type:'fill','source-layer':'water',source:'openmaptiles'},
  {id:'highway_major_inner',type:'line',
    'source-layer':'transportation',source:'openmaptiles'},
  {id:'highway_motorway_casing',type:'line',
    'source-layer':'transportation',source:'openmaptiles'},
  {id:'highway_path',type:'line',
    'source-layer':'transportation',source:'openmaptiles'},
  {id:'highway_name_other',type:'symbol',
    'source-layer':'transportation_name',source:'openmaptiles'},
  {id:'glide-junction-paint',type:'line',source:'glide-junction-markings'}
];
assert.deepEqual(baseRoadLayerIds(style),[
  'highway_major_inner','highway_motorway_casing','highway_path'
]);
const current=new Map([
  ['highway_major_inner','visible'],
  ['highway_motorway_casing','visible'],
  ['highway_path','none'],
  ['highway_name_other','visible'],
  ['glide-junction-paint','visible']
]);
const map={
  isStyleLoaded:()=>true,getStyle:()=>({layers:style}),
  getLayer:id=>style.some(l=>l.id===id),
  getLayoutProperty:(id)=>current.get(id),
  setLayoutProperty:(id,key,value)=>{
    assert.equal(key,'visibility');current.set(id,value);
  }
};
setStreetBasemapHidden(map,true);
assert.equal(current.get('highway_major_inner'),'none');
assert.equal(current.get('highway_motorway_casing'),'none');
assert.equal(current.get('highway_path'),'none');
assert.equal(current.get('highway_name_other'),'visible',
  'Street labels remain visible, only original road strokes disappear');
assert.equal(current.get('glide-junction-paint'),'visible',
  'Never hide reconstructed junction street markings');
setStreetBasemapHidden(map,true); // idempotent
setStreetBasemapHidden(map,false);
assert.equal(current.get('highway_major_inner'),'visible');
assert.equal(current.get('highway_motorway_casing'),'visible');
assert.equal(current.get('highway_path'),'none',
  'Original hidden layers stay hidden on exit');
forgetStreetBasemapStyle(map);

const route={
  geometry:{type:'LineString',coordinates:[
    [26,44],[26.004,44],[26.004,43.997]
  ]},
  properties:{summary:{lengthInMeters:650}}
};
const turn={routeOffsetInMeters:318,maneuver:'TURN_RIGHT'};
assert.equal(expectedLaneTurn(turn),'right');
assert.equal(expectedLaneTurn({maneuver:'TURN_LEFT'}),'left');
assert.equal(expectedLaneTurn({maneuver:'ROUNDABOUT'}),null);
assert.deepEqual(normalizeAllowedTurn(['through','right','right']),['through','right']);
function polygon(id,latStart,latEnd,turns=['right']){
 return {
  type:'Feature',properties:{
    type:'Driving',road:id,index:0,allowed_turns:turns,
    direction:'Forward'
  },
  geometry:{type:'Polygon',coordinates:[[
    [26.0011,latStart],[26.0041,latStart],
    [26.0041,latEnd],[26.0011,latEnd],[26.0011,latStart]
  ]]}
 };
}
const valid=polygon(101,44.000036,44.000068);
const opposite=polygon(102,44.00012,44.00016,['left']);
const traces=candidateApproachLanePaths(route,turn,[valid,opposite]);
assert.equal(traces.features.length,1,
  'Only lanes tagged for the actual turn generate provisional tracks');
assert.equal(traces.features[0].properties.road,101);
assert.equal(traces.features[0].properties.status,'candidate-only');
assert.ok(traces.features[0].geometry.coordinates.length>=4);
assert.ok(traces.features[0].geometry.coordinates.every(x=>x[1]>44.00002),
  'Candidate track should run inside the reconstructed lane polygon');
assert.ok(traces.features[0].geometry.coordinates.at(-1)[0]<26.004,
  'Lane candidate must terminate BEFORE intersection; never invent crossing link');
assert.equal(candidateApproachLanePaths(route,turn,[
  polygon(103,44.000036,44.000068,['left'])
]).features.length,0,'Contradicting turn arrows must not become lane paths');
assert.equal(candidateApproachLanePaths(route,turn,[
  {...valid,properties:{...valid.properties,allowed_turns:[]}}
]).features.length,0,'Missing turn evidence must not produce a path');
assert.equal(candidateApproachLanePaths(route,turn,[
  polygon(104,44.00036,44.00039)
]).features.length,0,'Unrelated road lane must not be snapped to route');
assert.equal(candidateApproachLanePaths(route,turn,[
  {...valid,properties:{...valid.properties,type:'Bus'}}
]).features.length,0,'Never propose a bus-only lane as general driving');

console.log('Glide original-road hiding, restoration and provisional lane-path tests passed.');
