// Per-tab client-side guard for optional TomTom traffic vector tiles.
// The official TomTom dashboard, not this counter, determines billed requests.
export const MAX_TRAFFIC_TILE_ATTEMPTS = 80;
export const EMPTY_TRAFFIC_TILE = 'data:application/x-protobuf;base64,';
export function isTomTomTrafficTile(url,resourceType) {
  if(resourceType!=='Tile' || typeof url!=='string')return false;
  try{
    const parsed=new URL(url);
    return parsed.protocol==='https:' &&
      /^(?:[a-d]\.)?api\.tomtom\.com$/i.test(parsed.hostname) &&
      parsed.pathname.startsWith('/traffic/map/') &&
      parsed.pathname.endsWith('.pbf');
  }catch{return false;}
}
export function trafficTileBudget(count) {
  const used=Number.isSafeInteger(count)?Math.max(0,count):0;
  return {used:Math.min(used,MAX_TRAFFIC_TILE_ATTEMPTS),
    remaining:Math.max(0,MAX_TRAFFIC_TILE_ATTEMPTS-used),
    exhausted:used>=MAX_TRAFFIC_TILE_ATTEMPTS};
}
