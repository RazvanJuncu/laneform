import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const detail=readFileSync(new URL('../src/junction-detail.js',import.meta.url),'utf8');
for(const id of [
 'diagnosticsTab','preferencesTab','diagnosticsContent',
 'diagnosticsSummary','diagnosticsSections','diagnosticsCounters',
 'diagnosticsScanner','diagnosticsCopy','diagnosticsRefresh',
 'navDiagnostics','diagnosticsCopyStatus'
]){
 assert.match(html,new RegExp('id="'+id+'"'),
  'Missing visible diagnostics control '+id);
}
assert.match(html,/role="tablist"/);
assert.match(html,/id="diagnosticsContent"[^>]+role="tabpanel"/);
assert.match(main,/function diagnosticSnapshotNow\(\)/);
assert.match(main,/function renderDiagnostics\(force=false\)/);
assert.match(main,/renderDiagnostics\(true\)/);
assert.match(main,/window\.glideDiagnosticsReport=/);
assert.match(main,/diagnosticsCopy[^\n]*addEventListener\('click'/);
assert.match(main,/navigator\.clipboard\.writeText\(report\)/);
assert.match(main,/onGuidanceChange:[\s\S]*?renderDiagnostics\(true\)/);
assert.match(detail,/requestStage:state\.requestStage/);
assert.match(detail,/lastOSMError:state\.lastOSMError/);
assert.match(detail,/laneFramesPerStation:/);
assert.match(detail,/hudGuidance:!!getSuggestedLanes\(\)/);
const render=main.slice(main.indexOf('function renderDiagnostics('),
 main.indexOf('function showSettings('));
assert.ok(!render.includes('fetch(')&&!render.includes('reconstruct('),
 'Diagnostics UI must not issue additional API or OSM calls');
console.log('Glide in-app Diagnostics tab, OSM evidence and report UI wiring passed.');
