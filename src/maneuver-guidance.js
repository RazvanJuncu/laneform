// Glide maneuver selection.
// Never announce arrival just because the next TomTom instruction is ARRIVE.
// Arrival is a future maneuver, not an event that already happened.
export function isArrivalInstruction(instruction) {
  if (!instruction) return false;
  const code = String(instruction.maneuver || '').toUpperCase();
  const type = String(instruction.instructionType || '').toUpperCase();
  const message = String(instruction.message || '');
  return type === 'LOCATION_ARRIVAL' ||
    code === 'ARRIVE' || code.startsWith('ARRIVE_') ||
    /^\s*(?:you (?:have )?(?:reached|arrived)|arriv(?:e|ing)|destination (?:is|on|reached)|end of route)/i.test(message);
}

export function nextManeuverState(instructions, progressMeters, routeLengthMeters) {
  const total = Math.max(0, Number(routeLengthMeters) || 0);
  const progress = Math.max(0, Math.min(total, Number(progressMeters) || 0));
  const left = Math.max(0, total - progress);
  // The exact same threshold is used for determining the arrival state
  // regardless of how many intermediate instructions are available.
  if (left <= 8) return {type:'complete',distance:0,instruction:null,index:-1};
  const all = Array.isArray(instructions) ? instructions : [];
  for (let index=0; index<all.length; index++) {
    const instruction=all[index];
    const at=instruction?.routeOffsetInMeters;
    if (!Number.isFinite(at) || at <= progress+12) continue;
    if (isArrivalInstruction(instruction)) continue;
    // Avoid presenting instructions that appear substantially beyond the end
    // of this route, which may indicate inconsistent provider offset data.
    if (at > total+40) continue;
    return {type:'turn',distance:Math.max(0,at-progress),instruction,index};
  }
  const arrival=all.find(isArrivalInstruction) || null;
  if (left <= 75) return {type:'approach',distance:left,instruction:arrival,index:-1};
  return {type:'cruise',distance:left,instruction:null,index:-1};
}

export function arrivalApproachText(instruction) {
  const code=String(instruction?.maneuver || '').toUpperCase();
  const message=String(instruction?.message || '').toLowerCase();
  if (code.endsWith('_LEFT') || /on (?:your |the )?left/.test(message))
    return 'Destination ahead on the left';
  if (code.endsWith('_RIGHT') || /on (?:your |the )?right/.test(message))
    return 'Destination ahead on the right';
  return 'Destination ahead';
}
