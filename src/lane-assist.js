// Glide lane intelligence / provider normalization.
// This module operates ONLY on lane sections already received with an
// explicitly requested route. It never fetches tiles, OSM, or TomTom itself.
const ALLOWED_DIRECTIONS = new Set([
  'STRAIGHT','SLIGHT_RIGHT','RIGHT','SHARP_RIGHT','RIGHT_U_TURN',
  'SLIGHT_LEFT','LEFT','SHARP_LEFT','LEFT_U_TURN'
]);
const ALLOWED_SEPARATORS = new Set([
  'UNKNOWN','NO_MARKING','LONG_DASHED','SHORT_DASHED','DOUBLE_DASHED',
  'SINGLE_SOLID','DOUBLE_SOLID','SOLID_DASHED','DASHED_SOLID',
  'SHADED_AREA_MARKING','DASHED_BLOCKS','CROSSING_ALERT','PHYSICAL_DIVIDER'
]);

export function normalizeLaneSection(section) {
  if (!section || !Array.isArray(section.lanes) ||
      section.lanes.length < 2 || section.lanes.length > 12) return null;
  const lanes = section.lanes.map(raw => {
    const directions = Array.isArray(raw?.directions) ?
      raw.directions.filter(dir => ALLOWED_DIRECTIONS.has(dir)) : [];
    const follow = ALLOWED_DIRECTIONS.has(raw?.follow) &&
      directions.includes(raw.follow) ? raw.follow : null;
    return {directions,follow,recommended:Boolean(follow)};
  });
  // If the provider hasn't selected a recommended lane, Glide must not
  // imply one. Lane-count-only data is insufficient for assistance.
  if (!lanes.some(lane => lane.recommended) ||
      lanes.some(lane => !lane.directions.length)) return null;

  const separators = Array.isArray(section.laneSeparators) ?
    section.laneSeparators.map(x => ALLOWED_SEPARATORS.has(x) ? x : 'UNKNOWN') : [];
  return {
    source:'tomtom',
    status:'provider-recommendation',
    lanes,
    separators: separators.length === lanes.length+1 ? separators : []
  };
}

export function extractRouteLaneGuidance(route, helper) {
  const instructions = route?.properties?.guidance?.instructions;
  if (!Array.isArray(instructions) || typeof helper !== 'function') return [];
  return instructions.map((instruction,index) => {
    let laneSection;
    try { laneSection = helper(route,instruction); }
    catch { laneSection = undefined; }
    return {index,offset:instruction.routeOffsetInMeters,
      guidance:normalizeLaneSection(laneSection)};
  }).filter(record =>
    Number.isFinite(record.offset) && record.offset >= 0 && record.guidance);
}

export function upcomingLaneGuidance(records, nextInstruction, progressMeters, showWithinMeters=480, instructionIndex=null) {
  if (!nextInstruction || !Array.isArray(records)) return null;
  const targetOffset=nextInstruction.routeOffsetInMeters;
  if (!Number.isFinite(targetOffset)) return null;
  const remaining=targetOffset-progressMeters;
  if (!Number.isFinite(remaining) || remaining < 12 || remaining > showWithinMeters) return null;
  const entry=records.find(record=>instructionIndex===null
    ? Math.abs(record.offset-targetOffset)<2
    : record.index===instructionIndex);
  if (!entry) return null;
  return {...entry.guidance,distanceToManeuver:remaining};
}

export const LANE_ARROWS = Object.freeze({
  STRAIGHT:'↑',SLIGHT_RIGHT:'↗',RIGHT:'↱',SHARP_RIGHT:'↱',
  RIGHT_U_TURN:'⤵',SLIGHT_LEFT:'↖',LEFT:'↰',SHARP_LEFT:'↰',
  LEFT_U_TURN:'⤴'
});
