import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildJunctionTargets,upcomingJunction,junctionViewMode,junctionCacheKey}
 from '../src/junction-logic.js';
import {smallAreaOsmUrl} from '../src/street-geometry-adapter.js';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const view=readFileSync(new URL('../src/junction-detail.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));

const route={
  geometry:{type:'LineString',coordinates:[[13.000,52.00],[13.020,52.00]]},
  properties:{summary:{lengthInMeters:1372},guidance:{instructions:[
    {maneuver:'TURN_LEFT',routeOffsetInMeters:250,message:'Turn left'},
    {maneuver:'TURN_RIGHT',routeOffsetInMeters:680,message:'Turn right'},
    {maneuver:'ARRIVE',instructionType:'LOCATION_ARRIVAL',
      routeOffsetInMeters:1372,message:'You have reached your destination'}
  ]}}
};
const junctions=buildJunctionTargets(route);
assert.equal(junctions.length,2,'Exclude arrival and identify consecutive junctions');
assert.ok(junctions[0].position[0]>13.003);
assert.equal(upcomingJunction(junctions,0).id,junctions[0].id);
assert.equal(upcomingJunction(junctions,290).id,junctions[1].id,
 'Crossing the first junction should advance preparation to the next one');
assert.equal(upcomingJunction(junctions,740),null);
assert.deepEqual(buildJunctionTargets({
  ...route,properties:{...route.properties,guidance:{instructions:[]}}
}),[]);
assert.equal(junctionCacheKey([13.12345,52]),'13.1235,52.0000');

const first=junctions[0];
const viewState={target:first,loaded:true,progress:100,zoom:15.65};
assert.equal(junctionViewMode(viewState),'detail',
  'Prepared geometry should reveal as the junction approaches');
assert.equal(junctionViewMode({...viewState,loaded:false}),'standard',
  'Never show empty diagram in absence of data');
assert.equal(junctionViewMode({...viewState,dismissedId:first.id}),'standard',
  'Zoom-out dismissal must override automatic zoom for that junction');
assert.equal(junctionViewMode({...viewState,progress:0}),'detail');
assert.equal(junctionViewMode({
  ...viewState,target:{...first,offset:400},progress:128
}),'detail','Junction Detail must be active with the target 272m ahead');
assert.equal(junctionViewMode({...viewState,progress:0,
  dismissedId:first.id,forcedId:first.id}),'standard');
assert.equal(junctionViewMode({...viewState,progress:500}),'standard',
  'Leave the close view after crossing the junction');
assert.equal(junctionViewMode({...viewState,progress:0,zoom:18.2,
  centerDistanceMeters:80}),'detail');
assert.equal(junctionViewMode({...viewState,progress:0,zoom:18.2,
  centerDistanceMeters:80,loaded:false}),'standard');

assert.ok(smallAreaOsmUrl([13.003,52],135).includes('api.openstreetmap.org'));
for(const id of ['junctionToggle','navHUD','navBar']){
  assert.ok(html.includes('id="'+id+'"'),'Missing integrated control: '+id);
}
assert.ok(!html.includes('id="geometryFetch"') &&
 !html.includes('Street geometry lab'),
 'Old lab controls must be removed from the passenger UI');
assert.ok(main.includes("junctionDetail?.begin(selectedRoute())") &&
  main.includes("junctionDetail?.update(offset)") &&
  main.includes("junctionDetail?.stop()"),
  'Simulation lifecycle must own the junction controller');
assert.ok(main.includes('zoom:detail?18.25:15.65'),
  'Map perspective must smoothly transition to the detailed junction zoom');
assert.ok(main.includes('event.originalEvent') &&
  main.includes("state.sim.follow=false"),
  'Manual map zoom must override camera follow');
assert.ok(view.includes('MAX_CACHE=5') && view.includes('COOLDOWN_MS=30000') &&
  view.includes('setTarget(next)') && !view.includes('setInterval('),
  'Junction requests must be small, cached and driven by crossing events');
assert.ok(view.includes('validateOsmXML(xml)') &&
  view.includes('net.toLanePolygonsGeojson()'),
  'Street geometry must be reconstructed by real osm2streets');
assert.ok(view.includes("state.pendingTimer=setTimeout") &&
  view.includes("state.inflight"),
  'The next junction should be queued once if the source is temporarily busy');
assert.ok(pkg.scripts.build.includes('smoke-osm2streets.mjs'));
assert.ok(view.includes('partitionJunctionGeometry(cached.data,state.route,next.offset)') &&
  view.includes('assign(m,e.data,e.selection,e.candidates,e.ordinal,e.planner,e.corridor)'),
  'Junction geometry must be partitioned around the provider route before drawing');
assert.ok(view.includes("const FOCUS_SOURCE='glide-junction-focus'") &&
  view.includes('simplifiedJunctionGeometry(data,selection)') &&
  view.includes('map.getSource(MARKS_SOURCE).setData(EMPTY)') &&
  view.includes("const actual=[IDS[0],IDS[1],IDS[2],IDS[3]].includes(id)?v:'none'"),
  'Junction Detail should render simplified driving surfaces without raw OSM arrows or debug layers');
assert.ok(main.includes('junctionFocus?2.6:3.4') &&
  main.includes('routeOutsideLaneCoverage(') &&
  main.includes('visibleLaneTrajectorySegments(') &&
  main.includes("stroke(laneSegments,'#BDF8E8',3.8,.98)") &&
  main.includes('window.glideLanePaintInfo=') &&
  view.includes('buildLaneCorridor(') &&
  view.includes('trajectory:()=>usableTrajectory()') &&
  view.includes('hasTrajectory:()=>!!usableTrajectory()') &&
  main.includes('const laneTrajectory=junctionDetail?.trajectory()||null') &&
  main.includes('if(laneCoverage.length)') &&
  view.includes("const actual=[IDS[0],IDS[1],IDS[2],IDS[3]].includes(id)?v:'none'"),
  'Lane trajectory must be drawn on the same topmost canvas as TomTom, with only non-covered centerline segments');
assert.ok(view.includes('net.toGeojsonPlain()') &&
  view.includes('buildJunctionOrdinalCandidates('),
  'Real osm2streets road-level connections must feed provisional lane pairing');
assert.ok(view.includes('const EXIT_SOURCE=') &&
  view.includes('map.getSource(EXIT_SOURCE).setData(EMPTY)') &&
  view.includes('twoStageLaneGuidance(') &&
  view.includes('sampleImportantThroughJunctions('),
  'Junction Detail should keep noisy candidates hidden and share route samples between map and staged lane HUD');
console.log('Glide progressive junction prefetch, zoom and lifecycle tests passed.');
