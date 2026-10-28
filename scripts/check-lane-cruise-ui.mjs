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
assert.equal(panel.children.length,0);
assert.equal(panel.hidden,true,
  'No Cruise status when no meaningful multi-lane choice exists');
render({source:'glide',kind:'cruise',status:'inferred',
  laneCount:3,selected:[1],turnOnly:[0],distanceToJunction:140});
assert.equal(panel.hidden,false);
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
render({source:'glide',kind:'cruise',mode:'available',status:'inferred',
  confidence:'heuristic',timing:'current',preferredSide:'right',
  laneCount:3,selected:[],distanceToJunction:0});
assert.match(panel.children[1].textContent,/Lanes mapped · no verified choice/,
  'Geometry-only Cruise must not imply a legal driving preference');
assert.ok(panel.children[2].children.every(item=>
  !item.className.includes('recommended')));
assert.match(panel.title,/no verified lane continuity/,
  'Do not present mapped lane count as verified route safety');
render({source:'glide',kind:'cruise',mode:'available',status:'inferred',
  confidence:'heuristic',timing:'upcoming',preferredSide:'left',
  laneCount:2,selected:[],distanceToJunction:85});
assert.match(panel.children[1].textContent,/Lanes mapped ahead · choice unverified · 85 m/);
assert.ok(panel.children[2].children.every(item=>
  !item.className.includes('recommended')));
render({source:'glide',kind:'cruise',mode:'turn-only',status:'inferred',
  laneCount:3,selected:[1,2],turnOnly:[0],distanceToJunction:110});
assert.ok(panel.children[2].children[1].className.includes('recommended'));
assert.ok(panel.children[2].children[2].className.includes('recommended'));
assert.match(panel.children[2].attrs['aria-label'],/lanes 2 and 3/);
render(null);
assert.equal(panel.hidden,true);
assert.equal(panel.children.length,0,
  'Loss of OSM evidence must remove stale lane selection immediately');
console.log('Glide persistent slim cruise HUD tests passed.');
