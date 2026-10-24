/**
 * Split a navigable route's geometry at the vehicle's cumulative distance.
 * The traveled and remaining segments share exactly one interpolated point,
 * so the muted and active route lines meet without gaps or overlaps.
 * Entirely local; never invokes routing services.
 */
export function splitPathByDistance(points, cumulative, distance) {
  if (!Array.isArray(points) || points.length < 2 ||
      !Array.isArray(cumulative) || cumulative.length !== points.length)
    return { traveled: [], remaining: [] };

  const total = cumulative[cumulative.length - 1];
  if (!Number.isFinite(total) || total <= 0)
    return { traveled: [], remaining: points.slice() };

  const d = Math.max(0, Math.min(total, Number.isFinite(distance) ? distance : 0));
  if (d <= 0) return { traveled: [], remaining: points.slice() };
  if (d >= total) return { traveled: points.slice(), remaining: [] };

  let low = 1;
  let high = cumulative.length - 1;
  while (low < high) {
    const midpoint = (low + high) >> 1;
    if (cumulative[midpoint] < d) low = midpoint + 1;
    else high = midpoint;
  }

  const end = low;
  const start = end - 1;
  const span = cumulative[end] - cumulative[start];
  const t = span > 0 ? Math.max(0, Math.min(1, (d - cumulative[start]) / span)) : 1;
  const a = points[start], b = points[end];
  const split = [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t
  ];

  return {
    traveled: [...points.slice(0, end), split],
    remaining: [split, ...points.slice(end)]
  };
}
