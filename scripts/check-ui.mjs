import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const style = JSON.parse(readFileSync(new URL('../src/glide-map-style.json', import.meta.url), 'utf8'));

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'Duplicate element IDs in index.html');
const existing = new Set(ids);
const references = [...js.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
const missing = [...new Set(references)].filter(id => !existing.has(id));
assert.deepEqual(missing, [], 'JavaScript must refer only to existing HTML IDs');

for (const id of ['idlePrompt','searchSheet','searchResults','recentList','originDescription',
  'previewSheet','routeChoices','navHUD','navBar','settingsPanel','map','routeOverlay'])
  assert.ok(existing.has(id), 'Missing expected UI element: ' + id);

for (const mode of ['idle','search','preview','navigation'])
  assert.ok(js.includes("mode === '"+mode+"'") || js.includes("setMode('"+mode+"')"),
    'Mode not wired: ' + mode);

assert.ok(html.includes('data-mode="idle"'), 'Initial state must be map-first idle');
assert.ok(js.includes("setMode('idle');"), 'Default JS mode must be idle');
assert.ok(js.includes("function searchDestinations()"), 'Explicit search handler missing');
assert.ok(js.includes("function chooseDestination(item)"), 'Destination selection handler missing');
assert.ok(js.includes("function rememberDestination(item)"), 'Recent destination cache missing');
assert.ok(js.includes("state.searchCache"), 'Search caching missing');
assert.ok(js.includes("ROUTE_TTL"), 'Route request caching missing');
assert.ok(js.includes("REQUEST_GAP"), 'Rate limiting missing');
assert.ok(js.includes("async function planRoute(force = false, chosenPlace = null)"),
  'Route planner must accept selected destination rather than searching implicitly');
assert.ok(css.includes('.idle-prompt') && css.includes('.search-sheet'), 'New styles missing');
assert.equal(style.version,8,'MapLibre style specification version');
assert.ok(style.sources?.openmaptiles,'The OSM-backed vector source must be present');
console.log('Glide Interface v3 structural checks passed ('+ids.length+' components).');
