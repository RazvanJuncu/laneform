import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {evaluateGlideDiagnostics} from '../src/glide-diagnostics.js';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=main.indexOf('let diagnosticsLastRender=0;');
const end=main.indexOf('function setMode(mode)',start);
assert.ok(start>=0&&end>start);
const ids=['settingsPanel','diagnosticsContent','diagnosticsSummary',
 'diagnosticsSections','diagnosticsCounters','diagnosticsScanner',
 'diagnosticsTab','preferencesTab','preferencesContent','apiKey'];
const make=()=>({
 hidden:false,children:[],textContent:'',attrs:{},tabIndex:0,
 replaceChildren(){this.children=[];},
 append(...nodes){this.children.push(...nodes);},
 setAttribute(k,v){this.attrs[k]=v;},
 focus(){this.focused=true;}
});
const nodes=Object.fromEntries(ids.map(id=>[id,make()]));
nodes.settingsPanel.hidden=false;
nodes.diagnosticsContent.hidden=false;
const document={createElement:()=>make()};
const info={guidanceMode:'junction',ready:false,
 targetCacheStatus:'unavailable',targetError:'OSM HTTP 429',
 targetOffsetMeters:500,progressMeters:220,
 distanceToTargetMeters:280,requesting:false,
 rollingCoverage:{activeStation:300,requestedStations:3,
  readyStations:[],failures:[{offset:300,message:'OSM HTTP 429'}]}};
const sandbox={
 $:id=>nodes[id],document,Date,GLIDE_BUILD_SHA:'test123456',
 junctionDetail:{info:()=>info},
 state:{mode:'navigation',sim:{active:true,playing:false}},
 selectedRoute:()=>({properties:{summary:{lengthInMeters:4000}}}),
 evaluateGlideDiagnostics
};
vm.createContext(sandbox);
vm.runInContext(main.slice(start,end)+
 '\nthis.drawDiagnostics=renderDiagnostics;this.showSettings=showSettings;',sandbox);
sandbox.drawDiagnostics(true);
assert.equal(nodes.diagnosticsSections.children.length,3);
assert.match(nodes.diagnosticsSections.children[0].children[1].textContent,
 /Junction mode deliberately hides Cruise/);
assert.match(nodes.diagnosticsSections.children[1].children[1].textContent,
 /429/);
assert.ok(nodes.diagnosticsCounters.children.length>=20);
assert.match(nodes.diagnosticsScanner.textContent,/OSM HTTP 429/);
assert.match(nodes.diagnosticsSummary.textContent,/test123/);
sandbox.showSettings('preferences');
assert.equal(nodes.diagnosticsContent.hidden,true);
sandbox.showSettings('diagnostics');
assert.equal(nodes.diagnosticsContent.hidden,false);
assert.equal(nodes.preferencesContent.hidden,true);
assert.equal(nodes.diagnosticsTab.attrs['aria-selected'],'true');
console.log('Glide live Diagnostics rendering and tab switching passed.');
