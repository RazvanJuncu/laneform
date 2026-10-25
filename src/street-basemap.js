// Replace OpenFreeMap road-stroke artwork with osm2streets geometry while
// a reconstructed junction is actually visible. Preserve labels, parks,
// buildings, and non-road lines. Restore original visibility exactly.
const snapshots=new WeakMap();
export function baseRoadLayerIds(layers){
  if(!Array.isArray(layers))return [];
  return layers.filter(layer=>layer?.type==='line' &&
    layer['source-layer']==='transportation' &&
    layer.source==='openmaptiles' &&
    !String(layer.id).startsWith('glide-'))
    .map(layer=>layer.id);
}
export function setStreetBasemapHidden(map,hidden){
  if(!map?.isStyleLoaded?.())return;
  const style=map.getStyle?.();
  if(!style?.layers)return;
  let store=snapshots.get(map);
  if(hidden){
    if(!store){
      store=new Map();
      snapshots.set(map,store);
    }
    for(const id of baseRoadLayerIds(style.layers)){
      if(store.has(id) || !map.getLayer(id))continue;
      const visibility=map.getLayoutProperty(id,'visibility');
      store.set(id,visibility??'visible');
      map.setLayoutProperty(id,'visibility','none');
    }
  }else if(store){
    for(const [id,visibility] of store){
      if(map.getLayer(id))map.setLayoutProperty(id,'visibility',visibility);
    }
    snapshots.delete(map);
  }
}
export function forgetStreetBasemapStyle(map){
  if(map)snapshots.delete(map);
}
