// Build-time only: vendor the exact osm2streets WASM release under Glide's
// own origin. Nothing extra is fetched when the normal navigator opens.
// npm package: osm2streets-js v0.1.4, Apache-2.0. See docs for attribution.
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const ORIGIN='https://cdn.jsdelivr.net/npm/osm2streets-js@0.1.4/';
const files=[
  {name:'osm2streets_js.js',min:12000,max:90000},
  {name:'osm2streets_js_bg.wasm',min:1200000,max:4000000}
];
const folder=join(process.cwd(),'public','vendor');
await mkdir(folder,{recursive:true});
for(const {name,min,max} of files){
  const response=await fetch(ORIGIN+name,{
    signal:AbortSignal.timeout(60000),
    headers:{'Accept':'*/*'}
  });
  if(!response.ok)throw Error('Could not vendor '+name+': HTTP '+response.status);
  const data=Buffer.from(await response.arrayBuffer());
  if(data.length<min||data.length>max)
    throw Error('Unexpected '+name+' size: '+data.length);
  if(name.endsWith('.wasm')&&data.subarray(0,4).toString('hex')!=='0061736d')
    throw Error('Invalid WASM signature');
  if(name.endsWith('.js')&&
     !data.toString('utf8').includes('JsStreetNetwork'))
    throw Error('Unexpected osm2streets JS bindings');
  await writeFile(join(folder,name),data);
  console.log('Vendored pinned osm2streets-js@0.1.4',name,data.length,'bytes');
}
