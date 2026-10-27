// Compose route-adjacent reconstructed lane hypotheses with osm2streets
// ROAD-level movement evidence. Ordinal preservation is merely a heuristic;
// nothing here establishes exact lane-to-lane junction connections.
import {candidateExitLanePaths,expectedLaneTurn} from './lane-path-candidates.js';
import {hasRoadLevelMovement,inferOrdinalContinuity} from './lane-continuity.js';
const empty=()=>({type:'FeatureCollection',features:[]});
function groups(features){
  const out=new Map();
  for(const feature of features||[]){
    const p=feature?.properties||{};
    if(!Number.isInteger(p.road)||!Number.isInteger(p.index)||
      !['Forward','Backward'].includes(p.direction))continue;
    const key=p.road+'/'+p.direction;
    if(!out.has(key))out.set(key,[]);
    out.get(key).push(feature);
  }
  return [...out.values()];
}
export function buildJunctionOrdinalCandidates({
  route,instruction,approaches=[],reconstructed=[],roads=[]
}={}){
  const result={status:'not-established',pairs:[],exits:empty(),
    explanation:'Lane correspondence has not been established'};
  const turn=expectedLaneTurn(instruction);
  if(!turn || !Array.isArray(roads)||roads.length===0)return result;
  const outgoing=candidateExitLanePaths(route,instruction,reconstructed);
  const possible=[];
  for(const incoming of groups(approaches)){
    for(const exit of groups(outgoing.features)){
      if(!hasRoadLevelMovement(roads,
        incoming[0].properties.road,exit[0].properties.road))continue;
      const guess=inferOrdinalContinuity(incoming,exit,{
        maneuver:turn,roadConnectionConfirmed:true,restrictionsClear:true
      });
      if(guess.status==='provisional')possible.push({guess,exit});
    }
  }
  // No arbitrary "best" pair if road/heading ambiguities produce two
  // competing options. Fall back to ordinary route-level navigation.
  if(possible.length!==1)return result;
  result.status='provisional';
  result.pairs=possible[0].guess.pairs;
  result.exits={
    type:'FeatureCollection',
    features:possible[0].exit.map(feature=>({
      ...feature,properties:{...feature.properties,
        status:'ordinal-hypothesis-not-verified'}
    }))
  };
  result.explanation='Lane positions preserved left-to-right between equal-count road groups; unverified junction geometry';
  return result;
}
