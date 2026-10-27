import assert from 'node:assert/strict';
import {routeProfile} from '../src/osm-lane-geometry.js';
import {buildLaneCorridor} from '../src/junction-road-corridor.js';

const polygon=(road,index,direction,left,right,bottom,top,turns=[])=>({
  type:'Feature',properties:{type:'Driving',road,index,direction,
    allowed_turns:turns},
  geometry:{type:'Polygon',coordinates:[[
    [left,bottom],[right,bottom],[right,top],
    [left,top],[left,bottom]
  ]]}
});
const line={type:'LineString',coordinates:[
  [26,44],[26,44.00077],[26,44.0015]
]};
const profile=routeProfile({geometry:line});
const route={type:'Feature',geometry:line,properties:{
  summary:{lengthInMeters:profile.length}
}};
const lanes=[
  polygon(7,0,'Forward',26.000012,26.000054,
    44.00002,44.00069),
  polygon(7,1,'Backward',25.999945,25.999987,
    44.00002,44.00069),
  polygon(8,0,'Forward',26.000012,26.000054,
    44.00085,44.00148),
  polygon(8,1,'Backward',25.999945,25.999987,
    44.00085,44.00148)
];
const result=buildLaneCorridor({
  route,offset:profile.length/2,lanes,radius:100
});
assert.equal(result.status,'provisional',
  'Build lane-aware line on a simple T-junction without an explicit turn');
assert.ok(result.coverage.length>=1);
assert.ok(result.path.features.length>=1);
assert.ok(result.samples>7);
assert.ok(result.path.features.every(f=>
  f.geometry.coordinates.every(p=>p[0]>26.000010)),
'Prefer the northbound driving lane, not the road center or oncoming lane');
assert.ok(result.path.features.some(f=>
  f.geometry.coordinates.some(p=>p[1]<44.00069) &&
  f.geometry.coordinates.some(p=>p[1]>44.00085)),
  'Bridge a short gap at the intersection with a smooth trajectory');
assert.ok(result.coverage.every(v=>
  Number.isFinite(v[0])&&Number.isFinite(v[1])&&v[0]<v[1]));
const leftRestricted=[
  {...lanes[0],properties:{...lanes[0].properties,allowed_turns:['left']}},
  lanes[1],
  {...lanes[2],properties:{...lanes[2].properties,allowed_turns:['left']}},
  lanes[3]
];
const contrary=buildLaneCorridor({
  route,offset:profile.length/2,lanes:leftRestricted,
  instruction:{routeOffsetInMeters:profile.length/2,maneuver:'STRAIGHT'},
  radius:100
});
assert.ok(contrary.path.features.every(f=>
  f.geometry.coordinates.every(p=>p[0]>26)),
  'Never direct the vehicle to oncoming lanes when forward arrows disagree');
assert.equal(buildLaneCorridor({route,offset:60,lanes:[]}).status,
  'unavailable','No driving-lane polygons: route-centerline fallback');

assert.equal(result.recommendation?.source,'glide');
assert.equal(result.recommendation?.laneCount,1,
  'A single forward driving lane produces one square in the HUD');
assert.deepEqual(result.recommendation?.selected,[0],
  'HUD selection must come from the rendered corridor');

// Two northbound lanes and one southbound lane (not three generic road lanes).
const twoForward=[
  polygon(7,0,'Forward',26.000012,26.000042,
    44.00002,44.00069),
  polygon(7,1,'Forward',26.000044,26.000074,
    44.00002,44.00069),
  lanes[1],
  polygon(8,0,'Forward',26.000012,26.000042,
    44.00085,44.00148),
  polygon(8,1,'Forward',26.000044,26.000074,
    44.00085,44.00148),
  lanes[3]
];
const rightSide=buildLaneCorridor({
  route,offset:profile.length/2,lanes:twoForward,radius:100
});
assert.equal(rightSide.recommendation?.laneCount,2,
  'Show only lanes matching the forward driving direction');
assert.deepEqual(rightSide.recommendation?.selected,[1],
  'Keep-right baseline selects the rightmost lane, not the road center');
const leftSide=buildLaneCorridor({
  route,offset:profile.length/2,lanes:twoForward,
  instruction:{routeOffsetInMeters:profile.length/2,
    maneuver:'TURN_LEFT'},radius:100
});
assert.equal(leftSide.recommendation?.laneCount,2);
assert.deepEqual(leftSide.recommendation?.selected,[0],
  'Left-turn maneuver selects the leftmost lane in the same mapped corridor');
assert.equal(leftSide.recommendation?.laneIndex,0);
assert.equal(buildLaneCorridor({
  route,offset:profile.length/2,lanes:[]}).recommendation,null,
  'Missing reconstructed lanes must not produce highlighted squares');


// Real osm2streets road identifiers may be opaque strings, and an exporter
// may serialize lane indices as strings. Their geometry is still actionable.
const opaqueRoads=twoForward.map((f,i)=>({
  ...f,properties:{...f.properties,
    road:'road-'+f.properties.road,index:String(f.properties.index)}
}));
const opaqueResult=buildLaneCorridor({
  route,offset:profile.length/2,lanes:opaqueRoads,radius:100
});
assert.equal(opaqueResult.status,'provisional',
  'String road identifiers must not eliminate valid driving lane geometry');
assert.equal(opaqueResult.recommendation?.laneCount,2);
assert.deepEqual(opaqueResult.recommendation?.selected,[1]);
assert.ok(opaqueResult.diagnostics.crossSections>0,
  'Real lane cross sections must be sampled before route rendering');
assert.ok(opaqueResult.diagnostics.schemaSamples.length>0);


// Some older osm2streets exports omit lane direction but retain motor-vehicle
// polygons. A *provisional map line* may be inferred on the right-hand side,
// but the HUD must not assert a lane ordinal without reliable metadata.
const withoutDirection=twoForward.map(f=>({
  ...f,properties:{...f.properties,direction:undefined}
}));
const inferred=buildLaneCorridor({
  route,offset:profile.length/2,lanes:withoutDirection,radius:100
});
assert.equal(inferred.status,'provisional',
  'Carriageway geometry can still power a provisional map path');
assert.deepEqual(inferred.recommendation?.selected,[1],
  'Right-hand traffic geometry can infer the mapped lane ordinal when road/index exist');
assert.equal(inferred.recommendation?.status,'inferred',
  'Missing direction still yields explicitly provisional, never verified, HUD guidance');
assert.ok(inferred.diagnostics.inferredDirectionPolygons>0);
const alternateSchema=twoForward.map(f=>({
  ...f,properties:{
    ...f.properties,type:undefined,lane_type:'Driving',
    road:undefined,road_id:String(f.properties.road),
    index:undefined,lane_index:String(f.properties.index),
    direction:String(f.properties.direction).toLowerCase()
  }
}));
const adapted=buildLaneCorridor({
  route,offset:profile.length/2,lanes:alternateSchema,radius:100
});
assert.equal(adapted.status,'provisional',
  'Adapt supported aliases instead of dropping every mapped driving polygon');
assert.deepEqual(adapted.recommendation?.selected,[1]);
const noType=twoForward.map(f=>({
  ...f,properties:{road:f.properties.road,index:f.properties.index,
    direction:f.properties.direction}
}));
const unsafe=buildLaneCorridor({
  route,offset:profile.length/2,lanes:noType,radius:100
});
assert.equal(unsafe.status,'unavailable',
  'Never infer that unknown polygon types are motor-vehicle lanes');
assert.equal(unsafe.diagnostics.rejected.type,noType.length);


// Once a left-turn lane is selected, keep its lateral position instead of
// moving into another mapped lane when the old +45m preference window ended.
// This synthetic straight roadway isolates lane continuity from turn curvature.
const longLine={type:'LineString',coordinates:[
  [26,44],[26,44.0011],[26,44.0026]
]};
const longProfile=routeProfile({geometry:longLine});
const longRoute={type:'Feature',geometry:longLine,properties:{
  summary:{lengthInMeters:longProfile.length}
}};
const threeForward=[
  polygon(72,0,'Forward',26.000015,26.000045,
    44.00005,44.00255),
  polygon(72,1,'Forward',26.000047,26.000077,
    44.00005,44.00255),
  polygon(72,2,'Forward',26.000079,26.000109,
    44.00005,44.00255)
];
const atTurn=longProfile.cumulative[1];
const consistent=buildLaneCorridor({
  route:longRoute,offset:atTurn,lanes:threeForward,radius:120,
  instruction:{routeOffsetInMeters:atTurn,maneuver:'TURN_LEFT'}
});
assert.equal(consistent.status,'provisional');
const longPath=consistent.path.features.flatMap(f=>
  f.geometry.coordinates);
assert.ok(longPath.length>20);
const measuredLanes=longPath.filter(p=>p[1]>44.00175);
assert.ok(measuredLanes.length>3);
assert.ok(measuredLanes.every(p=>p[0]<26.000050),
  'The chosen leftmost lane must remain leftmost >70m after a maneuver');
assert.deepEqual(consistent.recommendation?.selected,[0]);


// A roundabout needs an actual circulating lane graph and cannot be inferred
// by joining whichever polygon samples happen to be near the route line.
const roundabout=buildLaneCorridor({
  route:longRoute,offset:atTurn,lanes:threeForward,radius:120,
  instruction:{maneuver:'ROUNDABOUT_RIGHT',
    routeOffsetInMeters:atTurn}
});
assert.equal(roundabout.status,'unavailable',
  'Do not draw misleading lane-level paths through unsupported roundabouts');
assert.equal(roundabout.diagnostics.turnConnector,'unsupported-roundabout');
assert.equal(roundabout.path.features.length,0);
assert.equal(roundabout.recommendation,null,
  'The mini HUD must not present a guessed roundabout circulating lane');
const tinyFragment=buildLaneCorridor({
  route,offset:profile.length/2,radius:100,
  lanes:[polygon(555,0,'Forward',26.000015,26.000045,
    44.000350,44.000510)]
});
assert.equal(tinyFragment.status,'unavailable',
  'Tiny isolated lane stubs must not replace provider navigation');
assert.equal(tinyFragment.recommendation,null);

console.log('Glide geometry-first lane-corridor regression tests passed.');
