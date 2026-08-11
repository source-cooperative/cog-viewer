export type GeographicBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/**
 * Checks whether a geographic bounding box is safe to hand to maplibre-gl's
 * `fitBounds`. When a COG's declared CRS can't be resolved (or is otherwise
 * unsupported), reprojecting its corners to WGS84 can silently produce
 * `NaN`/`Infinity` or raw projected-CRS values (e.g. metres) instead of real
 * lng/lat — `maplibre-gl` then throws an uncaught "Invalid LngLat" error deep
 * inside `fitBounds` rather than failing gracefully.
 */
export function isValidGeographicBounds(bounds: GeographicBounds): boolean {
  const { west, south, east, north } = bounds;
  return (
    [west, south, east, north].every(Number.isFinite) &&
    south >= -90 &&
    south <= 90 &&
    north >= -90 &&
    north <= 90 &&
    south <= north
  );
}
