import assert from 'node:assert/strict';
import {routeProfile,positionAtDistance} from '../src/osm-lane-geometry.js';
import {splitImplausibleThroughPath} from '../src/lane-straight-sanity.js';
const lat=44,lon=26,c=Math.cos(lat*Math.PI/180);
const geo=(x,y)=>[lon+x/(111320*c),lat+y/110540];
const route={geometry:{type:'LineString',coordinates:[
  geo(0,0),geo(120,0)
]}};
const profile=routeProfile(route);
const line=Array.from({length:23},(_,i)=>({
  d:i*5,point:geo(i*5,2),road:7,index:0,direction:'Forward'
}));
const clean=splitImplausibleThroughPath(line,{profile,positionAtDistance});
assert.equal(clean.rejected,0,'A straight mapped lane remains intact');
assert.equal(clean.pieces.length,1);
assert.equal(clean.pieces[0].length,line.length);
const jagged=line.map(s=>({...s,point:[...s.point]}));
jagged[9].point=geo(45,8);
jagged[10].point=geo(50,9);
jagged[11].point=geo(55,2);
const filtered=splitImplausibleThroughPath(jagged,{profile,positionAtDistance});
assert.ok(filtered.rejected>=2,
  'Stray polygon centerline detour must not appear as a green S-shape');
assert.ok(filtered.pieces.length>=2);
const trueBend={geometry:{type:'LineString',coordinates:[
  geo(0,0),geo(50,0),geo(50,55)
]}};
const bendProfile=routeProfile(trueBend);
const bent=Array.from({length:20},(_,i)=>({
  d:i*5,point:positionAtDistance(bendProfile,i*5),
  road:i<=10?1:2,index:0,direction:'Forward'
}));
const checkBend=splitImplausibleThroughPath(bent,{
  profile:bendProfile,positionAtDistance
});
assert.equal(checkBend.rejected,0,
  'When the provider actually turns, do not erase the legitimate turn');
console.log('Glide straight-through lane path sanity tests passed.');
