import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {smallAreaOsmUrl,validateOsmXML,validateGeojson,MAX_OSM_BYTES}
 from '../src/street-geometry-adapter.js';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const lab=readFileSync(new URL('../src/street-geometry-lab.js',import.meta.url),'utf8');
const build=readFileSync(new URL('./vendor-osm2streets.mjs',import.meta.url),'utf8');
const packageJSON=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));

const url=new URL(smallAreaOsmUrl([26.062681,44.430196]));
assert.equal(url.origin,'https://api.openstreetmap.org');
const coords=url.searchParams.get('bbox').split(',').map(Number);
assert.equal(coords.length,4);
assert.ok(coords[0]<26.062681 && coords[2]>26.062681);
assert.ok(coords[1]<44.430196 && coords[3]>44.430196);
assert.ok((coords[2]-coords[0])<.01 && (coords[3]-coords[1])<.01,
  'No whole-city or unbounded public OSM API downloads');
assert.throws(()=>smallAreaOsmUrl([0,89]),/Unsupported/);
assert.throws(()=>smallAreaOsmUrl([Infinity,0]));
assert.throws(()=>validateOsmXML('<html>not OSM</html>'));
assert.deepEqual(Array.from(validateOsmXML('<osm version="0.6"></osm>')).slice(0,4),
  [60,111,115,109]);
assert.throws(()=>validateOsmXML('<osm>'+ 'a'.repeat(MAX_OSM_BYTES)+'</osm>'),/3 MB/);
const features=validateGeojson(JSON.stringify({type:'FeatureCollection',features:[
  {type:'Feature',geometry:{type:'Polygon',coordinates:[[
    [26,44],[26.0001,44],[26.0001,44.0001],[26,44]
  ]]},properties:{kind:'car'}},
  {type:'Feature',geometry:{type:'Point',coordinates:[26,44]},properties:{}}
]}));
assert.equal(features.features.length,1);
assert.equal(features.features[0].geometry.type,'Polygon');
assert.throws(()=>validateGeojson('{"type":"Point"}'),/FeatureCollection/);

for(const id of ['geometryFetch','geometryUpload','geometryStatus','geometryInspectHUD',
  'geometryInspectStatus','geometryExit']){
  assert.ok(html.includes('id="'+id+'"'),'Missing lab UI: '+id);
}
assert.ok(main.includes('wireGeometryLab(()=>state.map,setMode)'),
  'Lab must be wired into MapLibre initialization');
assert.ok(main.includes('setLabVisibility(state.map,mode === \'inspection\')'),
  'Lab layers must disappear from navigation');
assert.ok(lab.includes('network.toLanePolygonsGeojson()'));
assert.ok(lab.includes('network.toLaneMarkingsGeojson()'));
assert.ok(lab.includes('network.toIntersectionMarkingsGeojson()'));
assert.ok(lab.includes('const lib=await import(/* @vite-ignore */ path)'),
  'WebAssembly engine must be loaded lazily');
assert.ok(!main.includes("osm2streets_js.js"),
  'Normal route entry point must not directly import the heavy engine');
assert.ok(lab.includes('COOLDOWN_MS=30000'));
assert.ok(lab.includes('MAX_OSM_BYTES'));
assert.ok(build.includes('osm2streets-js@0.1.4'));
assert.ok(packageJSON.scripts.build.includes('vendor-osm2streets.mjs'));
console.log('Glide osm2streets adapter, opt-in loading and map lab tests passed.');
