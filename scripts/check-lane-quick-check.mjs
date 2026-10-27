import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const first=source.indexOf('function renderLaneAssistance(laneData,laneState=null){');
const last=source.indexOf('\nfunction navCamera(',first);
assert.ok(first>=0&&last>first,'HUD renderer must exist');
const panel={
  children:[],hidden:true,
  replaceChildren(){this.children=[];},
  append(...nodes){this.children.push(...nodes);}
};
const createElement=tag=>({
  tag,className:'',textContent:'',attrs:{},children:[],
  setAttribute(key,value){this.attrs[key]=value;},
  append(...nodes){this.children.push(...nodes);}
});
const context={
  document:{createElement},
  $:id=>{assert.equal(id,'laneGuidance');return panel;},
  distance:d=>Math.round(d)+' m'
};
vm.createContext(context);
vm.runInContext(source.slice(first,last)+'\nthis.drawHud=renderLaneAssistance;',context);
const render=context.drawHud;
const group=(count,index)=>({
  source:'glide',status:'inferred',
  laneCount:count,selected:[index]
});
render({source:'tomtom',status:'verified',selected:[0],laneCount:3});
assert.equal(panel.hidden,true,'Never display TomTom lane arrows');
render(null);
assert.equal(panel.hidden,true,'No invented lane guidance without geometry');
render({...group(3,1),distanceToManeuver:310});
assert.equal(panel.hidden,false);
assert.equal(panel.children.length,2,
  'Before the exit threshold only the approach row is visible');
assert.match(panel.children[0].textContent,/Suggested lanes · 310 m ahead/);
const approach=panel.children[1];
assert.equal(approach.children[0].textContent,'Approach');
assert.deepEqual(approach.children[1].children.map(s=>
  s.className.includes('recommended')),[false,true,false]);
assert.ok(approach.children[1].children.every(s=>s.children.length===0),
  'Squares must not contain arrows');
render({...group(2,0),distanceToManeuver:131,
  widensFrom:1,addedLaneIndices:[0]});
assert.equal(panel.children[1].children[0].textContent,
  'Approach · widens from 1',
  'Upcoming extra turning lane should be called out rather than implied upstream');
assert.equal(panel.children[1].children[1].children.length,2);
assert.equal(panel.children[1].children[1].children[0].textContent,'+');
assert.ok(panel.children[1].children[1].children[0].className.includes('added-lane'));
assert.equal(panel.children[1].children[1].children[1].textContent,'');
render({...group(3,1),distanceToManeuver:110,exit:group(2,0)});
assert.equal(panel.children.length,3,
  'Both rows appear when the geometry model reveals an exit lane');
assert.equal(panel.children[2].children[0].textContent,'After junction');
assert.deepEqual(panel.children[2].children[1].children.map(s=>
  s.className.includes('recommended')),[true,false]);
assert.match(panel.children[2].children[1].attrs['aria-label'],
  /After junction: 2 driving lanes, lane 1 of 2 highlighted/);
render({...group(2,0),distanceToManeuver:95,exit:group(3,2)});
assert.deepEqual(panel.children[2].children[1].children.map(s=>
  s.className.includes('recommended')),[false,false,true],
  'Exit row must follow the mapped destination lane, not reuse approach');
render({...group(2,0),exit:{...group(2,0),selected:[8]}});
assert.equal(panel.children.length,2,
  'Invalid/uncertain exit lanes must be omitted instead of fabricated');
render(null,{status:'road-level',description:'Missing local geometry'});
assert.equal(panel.children.length,1);
assert.match(panel.children[0].textContent,/road-level only/);
render(null,{status:'loading',description:'Preparing'});
assert.match(panel.children[0].textContent,/reconstructing lanes/);
render(null,{status:'trajectory-only',description:'Unknown lane count'});
assert.match(panel.children[0].textContent,/inferred path · lanes uncertain/);
console.log('Glide two-stage square lane HUD checks passed.');
