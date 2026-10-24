// Glide Street Geometry Lab — isolated, opt-in reconstruction experiment.
// Uses actual osm2streets v0.1.4 WASM, loaded ONLY when a user requests it.
// This is a geometric overlay, never used as authoritative lane navigation.
import {
  MAX_OSM_BYTES,MAX_GEOJSON_BYTES,
  smallAreaOsmUrl,validateOsmXML,validateGeojson,blankCollection
} from './street-geometry-adapter.js';

const IDs=Object.freeze({
  lanes:'glide-lab-lanes',markings:'glide-lab-markings',junctions:'glide-lab-junctions'
});
const COOLDOWN_MS=30000;
let lastAreaRequest=0;
let readyModule=null;
let busy=false;
let returnMode='idle';
let cameraBefore=null;
let exists=false;
let lastCenter=null;
let lastGeojson=null;

const $=id=>document.getElementById(id);
function status(text){$('geometryStatus').textContent=text;}
function boundsOf(lanes){
  let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
  function walk(coords){
    if(!Array.isArray(coords))return;
    if(coords.length>=2&&typeof coords[0]==='number'&&
      typeof coords[1]==='number' && Number.isFinite(coords[0])&&
      Number.isFinite(coords[1])){
      west=Math.min(west,coords[0]);east=Math.max(east,coords[0]);
      south=Math.min(south,coords[1]);north=Math.max(north,coords[1]);
      return;
    }
    for(const value of coords)walk(value);
  }
  for(const feature of lanes.features)walk(feature.geometry?.coordinates);
  if(![west,south,east,north].every(Number.isFinite)||
    east-west>1||north-south>1||west>=east||south>=north)return null;
  return [[west,south],[east,north]];
}
function prepareMap(map){
  if(!map?.isStyleLoaded?.())return false;
  for(const id of Object.values(IDs)){
    if(!map.getSource(id))map.addSource(id,{
      type:'geojson',data:blankCollection()
    });
  }
  if(!map.getLayer('glide-lab-surface'))map.addLayer({
    id:'glide-lab-surface',type:'fill',source:IDs.lanes,
    paint:{'fill-color':'#8AABB8','fill-opacity':.27}
  });
  if(!map.getLayer('glide-lab-lane-outline'))map.addLayer({
    id:'glide-lab-lane-outline',type:'line',source:IDs.lanes,
    paint:{'line-color':'#BED2DD','line-width':1,'line-opacity':.48}
  });
  if(!map.getLayer('glide-lab-marking-lines'))map.addLayer({
    id:'glide-lab-marking-lines',type:'line',source:IDs.markings,
    paint:{'line-color':'#F2F5F6','line-width':1.65,'line-opacity':.78}
  });
  if(!map.getLayer('glide-lab-junction-lines'))map.addLayer({
    id:'glide-lab-junction-lines',type:'line',source:IDs.junctions,
    paint:{'line-color':'#91AAB8','line-width':1.1,'line-opacity':.52}
  });
  return true;
}
export function setLabVisibility(map,visible){
  if(!map?.isStyleLoaded?.())return;
  const visibility=visible?'visible':'none';
  for(const id of ['glide-lab-surface','glide-lab-lane-outline',
    'glide-lab-marking-lines','glide-lab-junction-lines']){
    if(map.getLayer(id))map.setLayoutProperty(id,'visibility',visibility);
  }
}
async function engine(){
  if(readyModule)return readyModule;
  // The pinned JS and 1.8MB WASM are copied into /vendor during CI. They
  // stay on Glide's own origin, rather than loading from a third-party CDN
  // on every street inspection.
  const path=import.meta.env.BASE_URL+'vendor/osm2streets_js.js';
  const lib=await import(/* @vite-ignore */ path);
  await lib.default();
  if(typeof lib.JsStreetNetwork!=='function')
    throw Error('The packaged osm2streets engine is unavailable.');
  readyModule=lib;
  return lib;
}
function parseOptionalGeoJSON(raw){
  try{return validateGeojson(raw);}
  catch{return blankCollection();}
}
async function processOsm(xml){
  const bytes=validateOsmXML(xml);
  status('Reconstructing street lanes locally…');
  const lib=await engine();
  const config={
    debug_each_step:false,dual_carriageway_experiment:false,
    sidepath_zipping_experiment:false,inferred_sidewalks:false,
    inferred_kerbs:false,date_time:null,override_driving_side:''
  };
  let network;
  try{
    network=new lib.JsStreetNetwork(bytes,'',config);
    return {
      lanes:validateGeojson(network.toLanePolygonsGeojson()),
      markings:parseOptionalGeoJSON(network.toLaneMarkingsGeojson()),
      junctions:parseOptionalGeoJSON(network.toIntersectionMarkingsGeojson())
    };
  } finally {network?.free?.();}
}
function activate(map,onModeChange,data,source){
  if(!prepareMap(map))throw Error('The map is still loading.');
  map.getSource(IDs.lanes).setData(data.lanes);
  map.getSource(IDs.markings).setData(data.markings);
  map.getSource(IDs.junctions).setData(data.junctions);
  lastGeojson=data;
  exists=true;
  const beforeMode=document.body.dataset.mode;
  if(beforeMode!=='inspection'){
    returnMode=beforeMode==='navigation'?'idle':beforeMode;
    cameraBefore={
      center:map.getCenter(),zoom:map.getZoom(),
      pitch:map.getPitch(),bearing:map.getBearing()
    };
  }
  onModeChange('inspection');
  setLabVisibility(map,true);
  if(lastCenter)map.easeTo({
    center:lastCenter,zoom:Math.max(16.5,map.getZoom()),
    pitch:0,bearing:0,duration:750
  });
  else {
    const bounds=boundsOf(data.lanes);
    if(bounds)map.fitBounds(bounds,{
      padding:{top:100,bottom:125,left:55,right:55},
      pitch:0,bearing:0,maxZoom:18,duration:750
    });
  }
  $('geometryInspectStatus').textContent=
    data.lanes.features.length+' reconstructed lane shapes · '+source;
  status('Ready: '+data.lanes.features.length+
    ' lane shapes. Geometry inferred from OSM, not verified connectivity.');
}
async function withBusy(action){
  if(busy)return;
  busy=true;
  $('geometryFetch').disabled=true;
  $('geometryExample').disabled=true;
  $('geometryUpload').disabled=true;
  try{await action();}
  catch(error){
    console.error('Glide street geometry laboratory:',error);
    status('Unavailable: '+(error?.message||'could not read street geometry'));
  }finally{
    busy=false;
    $('geometryFetch').disabled=false;
    $('geometryExample').disabled=false;
    $('geometryUpload').disabled=false;
  }
}
async function fetchNearbyXml(center){
  if(Date.now()-lastAreaRequest<COOLDOWN_MS)
    throw Error('Small-area OSM requests are limited to one every 30 seconds.');
  lastAreaRequest=Date.now();
  const url=smallAreaOsmUrl(center);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),18000);
  try{
    const response=await fetch(url,{signal:controller.signal,
      credentials:'omit'});
    if(!response.ok)throw Error('OpenStreetMap API responded '+response.status);
    if(Number(response.headers.get('content-length'))>MAX_OSM_BYTES)
      throw Error('Too much OSM data for an in-browser import.');
    const xml=await response.text();
    if(new TextEncoder().encode(xml).length>MAX_OSM_BYTES)
      throw Error('Area contains too much OSM data; import a smaller extract.');
    return xml;
  }catch(error){
    if(error?.name==='AbortError')
      throw Error('OSM download timed out. Import a local .osm file instead.');
    throw error;
  }finally{clearTimeout(timer);}
}
export function wireGeometryLab(mapGetter,onModeChange){
  const map=()=>mapGetter();
  $('geometryFetch').addEventListener('click',()=>withBusy(async()=>{
    if(document.body.dataset.mode==='navigation')
      throw Error('Exit the route simulation before inspecting geometry.');
    const m=map();
    if(!m?.isStyleLoaded?.())throw Error('Map not ready.');
    const c=m.getCenter();
    lastCenter=[c.lng,c.lat];
    status('Downloading a small OpenStreetMap area (one explicit request)…');
    const xml=await fetchNearbyXml(lastCenter);
    const result=await processOsm(xml);
    activate(m,onModeChange,result,'osm2streets');
  }));
  $('geometryExample').addEventListener('click',()=>withBusy(async()=>{
    if(document.body.dataset.mode==='navigation')
      throw Error('Exit the route simulation before inspecting geometry.');
    status('Loading a bundled osm2streets test intersection…');
    const url=import.meta.env.BASE_URL+'lab-example.osm';
    const response=await fetch(url,{credentials:'omit'});
    if(!response.ok)throw Error('Could not load the bundled example.');
    const xml=await response.text();
    lastCenter=null;
    const result=await processOsm(xml);
    activate(map(),onModeChange,result,'osm2streets sample');
  }));
  $('geometryUpload').addEventListener('change',event=>withBusy(async()=>{
    const file=event.target.files?.[0];
    if(!file)return;
    try{
      if(file.size>MAX_GEOJSON_BYTES)
        throw Error('File is too large for the in-browser geometry lab.');
      if(document.body.dataset.mode==='navigation')
        throw Error('Exit the route simulation first.');
      const content=await file.text();
      let result;
      if(/\.geojson$|\.json$/i.test(file.name)){
        result={lanes:validateGeojson(content),
          markings:blankCollection(),junctions:blankCollection()};
        status('Opening an osm2streets GeoJSON export…');
      }else {
        result=await processOsm(content);
      }
      lastCenter=null;
      activate(map(),onModeChange,result,
        /\.json$/i.test(file.name)?'imported GeoJSON':'osm2streets');
    }finally {event.target.value='';}
  }));
  $('geometryExit').addEventListener('click',()=>{
    const m=map();
    setLabVisibility(m,false);
    onModeChange(returnMode);
    if(cameraBefore && m) m.easeTo({...cameraBefore,duration:700});
    cameraBefore=null;
  });
  map()?.on('style.load',()=>{
    if(exists && lastGeojson){
      prepareMap(map());
      for(const [key,id] of Object.entries(IDs))
        map().getSource(id)?.setData(lastGeojson[key]);
      setLabVisibility(map(),document.body.dataset.mode==='inspection');
    }
  });
}
