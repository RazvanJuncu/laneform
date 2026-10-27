import assert from 'node:assert/strict';
import {DEFAULT_SIM_RATE,NOMINAL_SIM_SPEED_KMH,
  simulationPlaybackRate,simulationMetersPerSecond,simulationSpeedLabel}
  from '../src/simulation-speed.js';
assert.equal(DEFAULT_SIM_RATE,7,'Preserve existing default playback');
assert.equal(NOMINAL_SIM_SPEED_KMH,45);
assert.equal(simulationPlaybackRate(.05),.5);
assert.equal(simulationPlaybackRate(200),15);
assert.equal(simulationPlaybackRate(NaN),7);
assert.equal(simulationPlaybackRate(2.24),2);
assert.equal(simulationPlaybackRate(2.26),2.5);
assert.equal(simulationMetersPerSecond(1),12.5);
assert.equal(simulationMetersPerSecond(4),50);
assert.equal(simulationMetersPerSecond(7),87.5,
  '7x playback should retain the previous simulator movement speed');
assert.match(simulationSpeedLabel(2),/2×.*90 km\/h/);
const html=(await import('node:fs')).readFileSync(
  new URL('../index.html',import.meta.url),'utf8');
assert.match(html,/id="navSpeed"[^>]*type="range"[^>]*min="0\.5"/);
assert.match(html,/id="navSpeedValue"/);
console.log('Glide adjustable simulation playback speed checks passed.');
