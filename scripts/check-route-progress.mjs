import assert from 'node:assert/strict';
import { splitPathByDistance } from '../src/route-progress.js';

const points = [[0,0],[10,0],[10,10]];
const offsets = [0,10,20];
const start = splitPathByDistance(points, offsets, 0);
assert.deepEqual(start.traveled, []);
assert.deepEqual(start.remaining, points);

const midpoint = splitPathByDistance(points, offsets, 15);
assert.deepEqual(midpoint.traveled, [[0,0],[10,0],[10,5]]);
assert.deepEqual(midpoint.remaining, [[10,5],[10,10]]);
assert.deepEqual(midpoint.traveled.at(-1),midpoint.remaining[0],
  'Muted trail and active route must meet without a gap');

const end = splitPathByDistance(points,offsets,20);
assert.deepEqual(end.traveled, points);
assert.deepEqual(end.remaining, []);

const beyond = splitPathByDistance(points,offsets,200);
assert.deepEqual(beyond.remaining,[]);
const negative = splitPathByDistance(points,offsets,-10);
assert.deepEqual(negative.traveled,[]);
const missing = splitPathByDistance([],[],7);
assert.deepEqual(missing,{traveled:[],remaining:[]});

console.log('Glide route-progress splitting tests passed.');
