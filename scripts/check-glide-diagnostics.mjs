import assert from 'node:assert/strict';
import {evaluateGlideDiagnostics,diagnosticsText}
  from '../src/glide-diagnostics.js';
const context={routeActive:true,simPlaying:true,
  routeLengthMeters:6400,version:'abc1234',now:1782630000000};
const scan={requestedStations:8,readyStations:[],failures:[],
  activeStation:900};
const basic={progressMeters:750,targetOffsetMeters:980,
  distanceToTargetMeters:230,ready:false,requesting:false,
  targetCacheStatus:'not-cached',requestStage:'idle',
  guidanceMode:'junction',targetCount:9,rollingCoverage:scan};
const noData=evaluateGlideDiagnostics(basic,context);
assert.equal(noData.sections[0].status,'suppressed',
  'Cruise is hidden by the junction state even if lanes are not ready');
assert.equal(noData.sections[1].status,'waiting',
  'Missing junction OSM data should be clearly distinguished from distance');
assert.equal(noData.sections[2].status,'waiting');
assert.equal(noData.counters.rollingRequests,8);
const failed=evaluateGlideDiagnostics({...basic,
  targetCacheStatus:'unavailable',targetError:'OSM HTTP 429',
  rollingCoverage:{...scan,failures:[{offset:900,message:'OSM HTTP 429'}]}},context);
assert.equal(failed.sections[1].status,'blocked');
assert.match(failed.sections[1].reason,/429/);
assert.equal(failed.scanner.failures.length,1);
const parallelActivity=evaluateGlideDiagnostics({...basic,
  targetCacheStatus:'unavailable',targetError:'Overpass HTTP 502',
  requesting:true,requestStage:'rolling-download',
  osmTransport:{source:'Private.coffee',consecutiveFailures:2,
    pauseRemainingMs:120000}
},context);
assert.equal(parallelActivity.sections[1].status,'blocked',
  'An existing failed junction must not appear pending due to rolling download');
assert.equal(parallelActivity.sections[2].status,'blocked');
assert.equal(parallelActivity.counters.osmProvider,'Private.coffee');
assert.equal(parallelActivity.counters.osmProviderBackoffSeconds,120);
const cooldown=evaluateGlideDiagnostics({...basic,
  guidanceMode:'cruise',targetOffsetMeters:null,
  distanceToTargetMeters:null,cooldownRemainingMs:12500,
  rollingCoverage:scan},context);
assert.equal(cooldown.sections[0].status,'waiting');
assert.match(cooldown.sections[0].reason,/13s/);
assert.equal(cooldown.sections[1].status,'no-target');
const farTurn=evaluateGlideDiagnostics({...basic,
  guidanceMode:'cruise',
  targetOffsetMeters:5600,progressMeters:200,
  distanceToTargetMeters:5400,junctionPrefetchLookaheadMeters:850
},context);
assert.equal(farTurn.sections[1].status,'distant',
  'A turn more than 5km away is intentionally NOT awaiting OSM');
assert.match(farTurn.sections[1].reason,/deferred until 850 m/);
assert.equal(farTurn.sections[0].status,'no-coverage');

const cruise=evaluateGlideDiagnostics({...basic,
  guidanceMode:'cruise',cruiseGuidance:{
    source:'glide',mode:'continuity',laneCount:3,selected:[1]
  }},context);
assert.equal(cruise.sections[0].status,'ready');
const neutral=evaluateGlideDiagnostics({...basic,
  guidanceMode:'cruise',cruiseGuidance:{
    source:'glide',mode:'available',laneCount:3,selected:[]
  }},context);
assert.equal(neutral.sections[0].status,'insufficient',
 'Geometry-only Cruise is not actionable lane guidance');
const provider=evaluateGlideDiagnostics({...basic,
  guidanceMode:'junction',hudGuidance:false
},{...context,providerLanesAvailable:true});
assert.equal(provider.sections[2].status,'ready');
assert.equal(provider.counters.activeLaneGuidanceSource,'tomtom-route');
const junctionReady=evaluateGlideDiagnostics({...basic,
  ready:true,active:true,corridorStatus:'provisional',
  hudGuidance:true,distanceToTargetMeters:80},context);
assert.equal(junctionReady.sections[1].status,'visible');
assert.equal(junctionReady.sections[2].status,'ready');
const previewFar=evaluateGlideDiagnostics({...basic,
  ready:true,distanceToTargetMeters:460},context);
assert.equal(previewFar.sections[1].status,'ahead');
const empty=evaluateGlideDiagnostics({...basic,guidanceMode:'cruise',
  targetOffsetMeters:null,ready:true,lanePolygons:0,mappedLaneFrames:0
},context);
assert.equal(empty.sections[0].status,'no-lanes');
const inactive=evaluateGlideDiagnostics({},{
  ...context,routeActive:false
});
assert.equal(inactive.sections[0].status,'inactive');
const exportText=diagnosticsText(failed);
assert.match(exportText,/Intersection preview \[blocked\]/);
assert.match(exportText,/abc1234/);
for(const forbidden of ['sk-proj-secret12345','26.061234','44.429876','Private street address']){
  assert.ok(!exportText.includes(forbidden),
    'Sanitized diagnostics should not contain '+forbidden);
}
const sensitive=evaluateGlideDiagnostics({...basic,
  targetCacheStatus:'unavailable',
  targetError:'Failed to fetch https://example.com/?api_key=secret1234&lat=44.429876'
},{...context});
const privateExport=diagnosticsText(sensitive);
assert.ok(!privateExport.includes('secret1234'),
  'URLs and URL query credentials must be scrubbed');
assert.ok(!privateExport.includes('44.429876'),
  'Raw coordinate data must not be exposed');

const fastSimulation=evaluateGlideDiagnostics({...basic,
  cooldownRemainingMs:8000
},{...context,playbackRate:7});
assert.match(fastSimulation.sections[1].reason,/700 m/,
  'Show how far a 7x simulation moves before the next OSM request');
assert.equal(fastSimulation.counters.playbackRate,'7×');
assert.equal(fastSimulation.counters.estimatedTravelDuringCooldown,'700 m');

console.log('Glide diagnostics reasons, phase suppression and safe export passed.');
