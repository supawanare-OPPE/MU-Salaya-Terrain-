// Heights here always use survey metres. Display translation/exaggeration is excluded.
export const ROAD_DATUM = 0.78;
export const MIN_WATER_CM = 10;
export const MAX_WATER_CM = 150;
export const WATER_STEP_CM = 10;

export function surveyWaterLevel(centimetres) {
  return ROAD_DATUM + centimetres / 100;
}

export function relativeGroundLevel(surveyHeight) {
  return surveyHeight - ROAD_DATUM;
}

export function waterDepth(surveyHeight, centimetres) {
  return Math.max(0, surveyWaterLevel(centimetres) - surveyHeight);
}

// Exact area fraction below a horizontal level on a linear TIN triangle.
// a <= b <= c are the triangle's survey heights; equal-height faces are supported.
export function wetFraction(a, b, c, level) {
  if (level <= a) return 0;
  if (level >= c) return 1;
  if (level < b) return (level - a) ** 2 / ((b - a) * (c - a));
  return 1 - (c - level) ** 2 / ((c - a) * (c - b));
}

export function inundatedArea(triangles, level) {
  let area = 0;
  for (let i = 0; i < triangles.length; i += 4) {
    area += triangles[i + 3] * wetFraction(triangles[i], triangles[i + 1], triangles[i + 2], level);
  }
  return area;
}
