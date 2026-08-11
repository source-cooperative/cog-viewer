/**
 * Chooses which deck.gl layers the map overlay should render.
 *
 * A COG whose geographic extent couldn't be determined (unresolved or
 * unsupported CRS) must NOT be drawn. The tile-placement path clamps
 * coordinates so its tiles would still paint — but at a wrong/meaningless
 * location, contradicting the "could not determine geographic extent" error
 * the user already sees. Gating here keeps the error and the rendered tiles
 * consistent: no valid extent, no tiles.
 */
export function selectOverlayLayers<L>(
  cogLayer: L | null,
  extentValid: boolean,
): L[] {
  if (!cogLayer || !extentValid) return [];
  return [cogLayer];
}
