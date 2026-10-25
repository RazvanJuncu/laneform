import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MAX_TRAFFIC_TILE_ATTEMPTS,EMPTY_TRAFFIC_TILE,
  isTomTomTrafficTile,trafficTileBudget} from '../src/traffic-budget.js';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

const traffic='https://api.tomtom.com/traffic/map/4/tile/flow/relative-delay/13/4726/3014.pbf?key=PRIVATE';
assert.equal(isTomTomTrafficTile(traffic,'Tile'),true);
assert.equal(isTomTomTrafficTile(traffic.replace('api.tomtom.com','a.api.tomtom.com'),'Tile'),true);
assert.equal(isTomTomTrafficTile(traffic,'Source'),false);
assert.equal(isTomTomTrafficTile('https://tiles.openfreemap.org/planet/13/4726/3014.pbf','Tile'),false);
assert.equal(isTomTomTrafficTile('https://api.tomtom.com/routing/1/calculateRoute','Tile'),false);
assert.equal(isTomTomTrafficTile('https://api.tomtom.com.evil.org/traffic/map/4/tile/flow/14/1/1.pbf','Tile'),false);
assert.equal(MAX_TRAFFIC_TILE_ATTEMPTS,80);
assert.ok(EMPTY_TRAFFIC_TILE.startsWith('data:'));
assert.deepEqual(trafficTileBudget(0),{used:0,remaining:80,exhausted:false});
assert.deepEqual(trafficTileBudget(80),{used:80,remaining:0,exhausted:true});
assert.deepEqual(trafficTileBudget(999),{used:80,remaining:0,exhausted:true});
assert.ok(main.includes('transformRequest(url,type)') &&
  main.includes('if(!isTomTomTrafficTile(url,type))return {url}'),
  'No additional monitoring or limits may touch unrelated map tiles');
assert.ok(main.includes('return {url:EMPTY_TRAFFIC_TILE}') &&
  main.includes('state.trafficTileAttempts++'),
  'Tile requests over budget must be blocked locally');
assert.ok(main.includes("glide.trafficTileAttempts"),
  'Per-tab request budget must survive a hard refresh');
assert.ok(main.includes("state.mode==='preview' && $('trafficToggle').checked") &&
  main.includes("map.getZoom()<=15"),
  'Traffic overlay must be manual, preview-only and limited in zoom');
assert.ok(main.includes("map.removeSource(sourceId)") &&
  main.includes("map.removeLayer(layerId)"),
  'Turning traffic off must detach the network tile source, not just hide pixels');
assert.ok(main.includes("if(mode!=='preview'){") &&
  main.includes("updateTrafficVisibility();"),
  'Navigation mode must stop traffic tile requests');
assert.ok(html.includes('id="trafficBudgetStatus"') &&
  html.includes('id="trafficToggle"'),
  'Explain traffic budget in Preferences');
assert.ok(main.includes("costModel:{routeType:'fast',traffic:'live'}"),
  'Route calculation must remain traffic-aware without map tile requests');
console.log('Glide TomTom per-tab traffic tile budget safeguards passed.');
