import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('function renderCruiseGuidance(cue){');
const end=source.indexOf('\nfunction navCamera(',start);
assert.ok(start>=0&&end>start,'Cruise renderer must exist');
const panel={
  children:[],title:'',
  replaceChildren(){this.children=[];},
  append(...items){this.children.push(...items);}
};
const document={createElement:tag=>({
  tag,className:'',textContent:'',attrs:{},children:[],
  setAttribute(k,v){this.attrs[k]=v;},
  append(...items){this.children.push(...items);}
})};
const sandbox={
  document,$:id=>{assert.equal(id,'cruiseGuidance');return panel;},
  distance:n=>Math.round(n)+' m'
};
vm.createContext(sandbox);
vm.runInContext(source.slice(start,end)+
  '\nthis.renderCruiseGuidance=renderCruiseGuidance;',sandbox);
const render=sandbox.renderCruiseGuidance;
render(null);
assert.equal(panel.children.length,2);
assert.equal(panel.children[0].textContent,'Cruise');
assert.match(panel.children[1].textContent,/lanes unverified/,
  'Cruise is persistent but neutral without strong evidence');
render({source:'glide',kind:'cruise',status:'inferred',
  laneCount:3,selected:[1],turnOnly:[0],distanceToJunction:140});
assert.equal(panel.children.length,3);
assert.match(panel.children[1].textContent,/140 m/);
assert.equal(panel.children[2].children.length,3);
assert.ok(panel.children[2].children[0].className.includes('turn-only'));
assert.ok(panel.children[2].children[1].className.includes('recommended'));
assert.equal(panel.children[2].children[2].className,'cruise-pill');
assert.equal(panel.children[2].children[1].textContent,'',
  'Cruise ovals never receive directional arrows');
assert.match(panel.children[2].attrs['aria-label'],/lane 2/);
render({source:'glide',kind:'cruise',mode:'alignment',status:'inferred',
  laneCount:2,selected:[0],turnOnly:[],distanceToJunction:315});
assert.match(panel.children[1].textContent,/Align for next turn/);
assert.match(panel.title,/No turn-only restrictions verified/,
  'Geometry-derived Cruise must not claim verified turn-only lanes');
assert.equal(panel.children[2].children.length,2);
render(null);
assert.equal(panel.children.length,2,
  'Loss of OSM evidence must remove stale lane selection immediately');
console.log('Glide persistent slim cruise HUD tests passed.');
