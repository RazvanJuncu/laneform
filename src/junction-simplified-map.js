// Driver-oriented display, derived from osm2streets geometry already cached.
// Internal lane markings/arrows remain available to navigation logic but are
// intentionally omitted from the simplified Junction Detail rendering.
const collection=features=>({type:'FeatureCollection',features});
const driving=feature=>{
  const raw=feature?.properties?.type??
    feature?.properties?.lane_type??feature?.properties?.laneType;
  const name=typeof raw==='string'?raw.toLowerCase().replace(/[^a-z]/g,''):'';
  return ['driving','drive','motorvehicle','motorcar','vehicular'].includes(name);
};
const polygon=feature=>
  ['Polygon','MultiPolygon'].includes(feature?.geometry?.type);
export function simplifiedJunctionGeometry(data,selection){
  const raw=Array.isArray(data?.lanes?.features)?data.lanes.features:[];
  const focus=Array.isArray(selection?.focus?.features)?selection.focus.features:[];
  // Render only drivable road surfaces. No footpaths, crosswalk hashes,
  // intersection debug contours, candidate lines or turn-arrow glyphs.
  const roads=raw.filter(f=>driving(f)&&polygon(f));
  const highlighted=focus.filter(f=>driving(f)&&polygon(f));
  return {
    roads:collection(roads),
    focus:collection(highlighted),
    roadCount:roads.length,
    focusCount:highlighted.length
  };
}
