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
for (const id of ['routesTray','routesToggle','routesClose','routeAlternativeCount','startPreview'])
  assert.ok(existing.has(id), 'Missing v3.1 journey pod control: ' + id);
assert.ok(/id="startPreview"[^>]*>Start\s*</.test(html),
  'The primary navigation control must say Start');
assert.ok(!html.includes('id="alternativesDetails"'),
  'Alternatives should not appear as a stacked details row');
assert.ok(js.includes('function closeRoutesTray()') && js.includes('function toggleRoutesTray()'),
  'The separate routes tray must have open/close behavior');
assert.ok(js.includes('isReducedMotion ? 0 : 930'),
  'Camera motion token should be slow and reduced-motion aware');
assert.ok(css.includes('--pod-radius:34px') && css.includes('--control-radius:999px'),
  'New rounded geometry design tokens are required');
for (const id of ['idleVeil','idlePrompt','navArrow','navDistance','navInstruction'])
  assert.ok(existing.has(id),'Missing v3.2 bubble feature: '+id);
assert.ok(html.includes('<div id="idleVeil" aria-hidden="true"></div>'),
  'Idle map must have a passive dimming veil');
assert.ok(/id="startPreview"[^>]*>Start<\/button>/.test(html),
  'Start action must have no external-link arrow');
assert.ok(!html.includes('class="nav-header"'),
  'Do not show redundant navigation header or decorative dot');
assert.ok(js.includes("permission.state !== 'granted'"),
  'Startup geolocation must not prompt without prior browser permission');
assert.ok(js.includes('centerInitialView();') && js.includes('center: DEMO_ORIGIN,'),
  'Map must initialize at demo location and check granted location');
assert.ok(js.includes("mapMarkerElement('destination-donut'") &&
  js.includes("mapMarkerElement('route-origin-dot'"),
  'New map markers must be donut and dot variants');
assert.ok(css.includes('.destination-donut') && css.includes('#idleVeil') &&
  css.includes('glide-idle-center'),
  'V3.2 marker, dark veil and centered bubble styles are missing');
assert.ok(css.includes('top:var(--search-center-y,50%)'),
  'Search should be centered within the visible viewport, not bottom anchored');
assert.ok(css.includes('.search-sheet .result-donut'),
  'Search results must share the donut symbol from map destinations');
assert.ok(js.includes("ring.className = 'result-donut'"),
  'Search result pin glyph must use donut rings');
assert.ok(js.includes('splitPathByDistance(') &&
  js.includes("if (traveled.length >= 2) stroke([traveled], '#73818B'"),
  'Simulated route must show an unlit, gray traveled segment');
assert.ok(js.includes('requestDraw(); // update the muted traveled route'),
  'Route progress must be redrawn even when camera follow is off');
assert.ok(js.includes('revealPreviewFromSearch(searchRect)'),
  'Centered selection must migrate gracefully to bottom preview');
console.log('Glide v3.3 centered search, ring icons and route trail checks passed.');
console.log('Glide v3.2 borderless bubbles, location startup and donut marker checks passed.');
console.log('Glide v3.1 pod, pill dock and weighted-motion checks passed.');
console.log('Glide Interface v3 structural checks passed ('+ids.length+' components).');
