// Build-time native smoke test for the actual wasm-bindgen package using an
// upstream osm2streets regression fixture (tiny_roundabout/input.osm).
// This catches broken WASM/JS glue or incompatible ImportOptions in CI.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const js=resolve('public/vendor/osm2streets_js.js');
const wasm=await readFile(resolve('public/vendor/osm2streets_js_bg.wasm'));
const xml=await readFile(resolve('public/lab-example.osm'),'utf8');
const lib=await import(pathToFileURL(js).href);
await lib.default(wasm);
const network=new lib.JsStreetNetwork(xml,'',{
  osm2lanes:false,
  debug_each_step:false,dual_carriageway_experiment:false,
  sidepath_zipping_experiment:false,inferred_sidewalks:false,
  inferred_kerbs:false,date_time:null,override_driving_side:''
});
try {
  const lanes=JSON.parse(network.toLanePolygonsGeojson());
  const marks=JSON.parse(network.toLaneMarkingsGeojson());
  const roads=JSON.parse(network.toGeojsonPlain());
  if(roads?.type!=='FeatureCollection'||!Array.isArray(roads.features))
    throw Error('Missing road-level intersection and movement network');
  console.log('osm2streets road network:',roads.features.length,'geometries');

  if(lanes?.type!=='FeatureCollection'||!Array.isArray(lanes.features)||
    lanes.features.length===0)throw Error('WASM produced no lane polygons');
  if(marks?.type!=='FeatureCollection'||!Array.isArray(marks.features))
    throw Error('WASM returned invalid lane marking geometry');
  console.log('osm2streets WASM smoke test passed: ',
    lanes.features.length,'lane geometries,',
    marks.features.length,'lane marking geometries');
}finally{network.free?.();}
