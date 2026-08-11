import { describe, expect, it } from "vitest";
import { selectOverlayLayers } from "../overlay-layers";

describe("selectOverlayLayers", () => {
  it("renders the COG layer when the extent is valid", () => {
    const layer = { id: "cog" };
    expect(selectOverlayLayers(layer, true)).toEqual([layer]);
  });

  it("renders nothing when there is no COG layer", () => {
    expect(selectOverlayLayers(null, true)).toEqual([]);
  });

  // The reported bug: a COG whose CRS/extent couldn't be determined shows the
  // "could not determine geographic extent" error, yet its tiles still paint
  // (mislocated) because the tile-placement path clamps coordinates. Gating on
  // extent validity keeps the error and the rendered tiles consistent.
  it("renders nothing when the geographic extent is invalid, even if a layer exists", () => {
    const layer = { id: "cog" };
    expect(selectOverlayLayers(layer, false)).toEqual([]);
  });
});
