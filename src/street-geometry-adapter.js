// Local-only adapter between osm2streets GeoJSON and Glide's MapLibre map.
// No lane polygons are promoted to verified routing guidance by this module.
export const MAX_OSM_BYTES=3_000_000;
export const MAX_GEOJSON_BYTES=6_000_000;
export const MAX_FEATURES=12000;

export function smallAreaOsmUrl(center, radiusMeters=165){
  if(!Array.isArray(center)||center.length!==2||
    !center.every(Number.isFinite)||Math.abs(center[0])>180||
    Math.abs(center[1])>85)throw Error('Unsupported inspection coordinates');
  // A small explicit OSM download, not a tile server or continuous poll.
  const r=Math.max(80,Math.min(190,radiusMeters));
  const latDelta=r/111320;
  const lonDelta=r/(111320*Math.cos(center[1]*Math.PI/180));
  const bbox=[
    Math.max(-180,center[0]-lonDelta),
    Math.max(-85,center[1]-latDelta),
    Math.min(180,center[0]+lonDelta),
    Math.min(85,center[1]+latDelta)
  ];
  return 'https://api.openstreetmap.org/api/0.6/map?bbox='+
    bbox.map(x=>x.toFixed(6)).join(',');
}
export function validateOsmXML(xml){
  if(typeof xml!=='string'||!/<osm(?:\s|>)/i.test(xml.slice(0,1200)))
    throw Error('Import a complete .osm XML extract, not GeoJSON or an OSM link.');
  const bytes=new TextEncoder().encode(xml);
  if(bytes.length>MAX_OSM_BYTES)throw Error('OSM extract exceeds the 3 MB lab limit.');
  return bytes;
}
export function validateGeojson(input){
  const json=typeof input==='string'?JSON.parse(input):input;
  if(!json||json.type!=='FeatureCollection'||!Array.isArray(json.features))
    throw Error('Expected a GeoJSON FeatureCollection from osm2streets.');
  if(json.features.length>MAX_FEATURES)
    throw Error('Geometry contains too many features for this prototype.');
  const clean=json.features.filter(feature=>{
    const geometry=feature?.geometry;
    return feature.type==='Feature'&&geometry&&
      ['Polygon','MultiPolygon','LineString','MultiLineString'].includes(geometry.type)&&
      Array.isArray(geometry.coordinates);
  }).map(({type,geometry,properties})=>({
    type,geometry,properties: properties && typeof properties==='object' ? properties : {}
  }));
  if(clean.length===0)throw Error('No supported lane geometry in the imported file.');
  return {type:'FeatureCollection',features:clean};
}
export function blankCollection(){return {type:'FeatureCollection',features:[]};}
