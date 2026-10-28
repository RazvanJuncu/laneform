import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {providerTurnLaneHud} from '../src/provider-lane-fallback.js';
import {smallAreaOverpassUrl,smallAreaOsmUrl}
  from '../src/street-geometry-adapter.js';

const provider={source:'tomtom',status:'provider-recommendation',
  distanceToManeuver:220,lanes:[
    {directions:['LEFT'],follow:null,recommended:false},
    {directions:['STRAIGHT','RIGHT'],follow:'RIGHT',recommended:true},
    {directions:['RIGHT'],follow:'RIGHT',recommended:true}
  ]};
const guidance=providerTurnLaneHud(provider);
assert.equal(guidance.source,'tomtom');
assert.deepEqual(guidance.selected,[1,2]);
assert.equal(guidance.exit,null,
  'TomTom does not imply a mapped post-junction lane connector');
assert.equal(providerTurnLaneHud({...provider,
  distanceToManeuver:700}),null,'Only imminent real maneuver sections');
assert.equal(providerTurnLaneHud({...provider,
  lanes:provider.lanes.map(lane=>({...lane,follow:null,recommended:false}))}),
  null,'Never invent a provider recommendation from lane counts');
assert.equal(providerTurnLaneHud({...provider,source:'glide'}),null);
assert.equal(providerTurnLaneHud({...provider,lanes:[
  {directions:['LEFT'],follow:'RIGHT',recommended:true},
  provider.lanes[1]]}),null,
  'A marked follow not permitted by its lane cannot be accepted');

const url=new URL(smallAreaOverpassUrl([26.06,44.43],130));
assert.equal(url.origin,'https://overpass-api.de');
const q=url.searchParams.get('data');
assert.match(q,/\[out:xml\]/);
assert.match(q,/way\(44\./);
assert.match(q,/node\(44\./);
assert.match(q,/out body;/);
assert.ok(smallAreaOsmUrl([26.06,44.43],130).includes('bbox='),
  'Preserve the legacy bbox utility for tests and export tools');

const detail=readFileSync(new URL('../src/junction-detail.js',import.meta.url),'utf8');
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
assert.match(detail,/const url=smallAreaOverpassUrl\(position,radiusMeters\)/,
  'Navigation downloads must use read-only OSM data access');
assert.match(main,/providerTurnLaneHud\(upcomingLaneGuidance\(/,
  'Only already-loaded TomTom lane guidance can be used as fallback');
assert.match(main,/now-\(renderNavigationLaneHud\.lastAt\|\|0\)<220/,
  'Do not re-render the entire lane HUD every animation frame');
console.log('Glide provider fallback and read-only geometry source tests passed.');
