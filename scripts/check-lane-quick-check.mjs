import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const first=source.indexOf('function renderLaneAssistance(laneData,laneState=null){');
const last=source.indexOf('\nfunction navCamera(',first);
assert.ok(first>=0&&last>first,'Mini HUD renderer must exist');
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
render({source:'tomtom',status:'verified',lanes:[{recommended:true}]});
assert.equal(panel.hidden,true,
  'TomTom must never show a conflicting recommendation');
render(null);
assert.equal(panel.hidden,true,
  'When no reconstructed approach lane is ready, leave the HUD hidden');
render({source:'glide',status:'inferred',laneCount:3,
  selected:[1],distanceToManeuver:310});
assert.equal(panel.hidden,false);
assert.equal(panel.children.length,2);
assert.match(panel.children[0].textContent,
  /Suggested lanes · 310 m ahead · Glide \(inferred\)/);
const squares=panel.children[1].children;
assert.equal(squares.length,3,'One square per forward-direction driving lane');
assert.deepEqual(squares.map(square=>
  square.className.includes('recommended')),[false,true,false],
  'Only the lane represented by the map trajectory lights up');
assert.ok(squares.every(s=>s.children.length===0),
  'No maneuver arrows inside the lane squares');
assert.match(panel.children[1].attrs['aria-label'],/lane 2 of 3 highlighted/);
render({source:'glide',status:'inferred',laneCount:2,
  selected:[0],distanceToManeuver:95});
assert.deepEqual(panel.children[1].children.map(s=>
  s.className.includes('recommended')),[true,false],
  'The highlight must update when the next chosen map lane changes');
render({source:'glide',status:'inferred',laneCount:2,selected:[5]});
assert.equal(panel.hidden,true,
  'Invalid or out-of-range recommended lanes must not be displayed');
render(null,{status:'road-level',
  description:'No suitable reconstructed driving lane sections'});
assert.equal(panel.hidden,false,
  'During Junction Detail the missing lane information must be explained');
assert.match(panel.children[0].textContent,/road-level only/);
assert.equal(panel.children.length,1,
  'Do not render placeholder or invented recommendation squares');
render(null,{status:'loading',description:'Preparing reconstructed lanes'});
assert.match(panel.children[0].textContent,/reconstructing lanes/);
render(null,{status:'trajectory-only',
  description:'Mapped trajectory exists but the approach lane count is uncertain'});
assert.equal(panel.hidden,false);
assert.equal(panel.children.length,1,
  'A trajectory without a reliable lane count must not invent squares');
assert.match(panel.children[0].textContent,/inferred path · lanes uncertain/,
  'Show visible Glide path as inferred, not incorrectly road-level');
console.log('Glide arrowless lane HUD and corridor selection sync tests passed.');
