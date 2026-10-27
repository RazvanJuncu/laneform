export const NOMINAL_SIM_SPEED_KMH=45;
export const DEFAULT_SIM_RATE=7;
export function simulationPlaybackRate(raw){
  const number=Number(raw);
  return Number.isFinite(number)
    ?Math.max(.5,Math.min(15,Math.round(number*2)/2))
    :DEFAULT_SIM_RATE;
}
export function simulationMetersPerSecond(rate){
  return NOMINAL_SIM_SPEED_KMH/3.6*simulationPlaybackRate(rate);
}
export function simulationSpeedLabel(rate){
  const speed=simulationPlaybackRate(rate);
  return speed.toLocaleString('en-US',{maximumFractionDigits:1})+
    '× · ≈'+Math.round(NOMINAL_SIM_SPEED_KMH*speed)+' km/h preview';
}
