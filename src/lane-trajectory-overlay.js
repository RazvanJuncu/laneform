// Single-painter Glide navigation overlay.
// The selected route remains road-level outside verified geometric coverage;
// inside a provisional corridor the displayed line comes from the same
// reconstructed lane samples as the mini lane HUD.
const valid=p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1]);
function segmentMeters(a,b){
  const cosine=Math.max(.08,Math.cos((a[1]+b[1])*.5*Math.PI/180));
  return Math.hypot((b[0]-a[0])*111320*cosine,
    (b[1]-a[1])*110540);
}
export function clipCoordinateLine(points,fraction){
  if(!Array.isArray(points)||points.length<2||!points.every(valid))
    return [];
  if(!Number.isFinite(fraction)||fraction<=0)return points;
  if(fraction>=1)return [];
  const distance=[0];
  for(let i=1;i<points.length;i++)
    distance.push(distance.at(-1)+segmentMeters(points[i-1],points[i]));
  const total=distance.at(-1);
  if(total<.1)return [];
  const target=total*fraction;
  for(let i=1;i<distance.length;i++){
    if(distance[i]<target)continue;
    const span=distance[i]-distance[i-1];
    const t=span>0?(target-distance[i-1])/span:0;
    const a=points[i-1],b=points[i];
    return [[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])],
      ...points.slice(i)];
  }
  return [];
}
export function visibleLaneTrajectorySegments(trajectory,progressMeters){
  if(!trajectory||trajectory.source!=='glide'||
    !Number.isFinite(progressMeters))return [];
  const features=trajectory.features,coverage=trajectory.coverage;
  if(!Array.isArray(features)||!Array.isArray(coverage)||
    features.length!==coverage.length)return [];
  const lines=[];
  for(let i=0;i<features.length;i++){
    const range=coverage[i];
    const coords=features[i]?.geometry?.coordinates;
    if(!Array.isArray(range)||range.length!==2||
      !range.every(Number.isFinite)||range[1]<=range[0]||
      features[i]?.geometry?.type!=='LineString'||!Array.isArray(coords)||
      coords.length<2||!coords.every(valid))continue;
    const [from,to]=range;
    if(to<=progressMeters)continue;
    const fraction=(progressMeters-from)/(to-from);
    const ahead=clipCoordinateLine(coords,fraction);
    if(ahead.length>=2)lines.push(ahead);
  }
  return lines;
}
