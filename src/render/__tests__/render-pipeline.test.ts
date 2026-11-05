import { describe, expect, it } from "vitest";
import { buildRgbCompositeRenderTile } from "../render-pipeline";
import { FilterTransparent } from "../shader-modules";
import type { MultiBandTileData } from "../tile-loader";
import { parseCogState } from "../../state/useCogState";

const DEFAULT_STATE = parseCogState(new URLSearchParams());

const tile = (n: number) =>
  ({
    bands: new Map(
      Array.from({ length: n }, (_, i) => [
        String(i + 1),
        { texture: { id: `t${i + 1}` }, uvTransform: [0, 0, 1, 1] },
      ]),
    ),
    nodata: null,
    sampleScale: 255,
  }) as unknown as MultiBandTileData;

describe("alpha band", () => {
  it("maps the alpha band into CompositeBands and discards transparent pixels", () => {
    const { renderPipeline } = buildRgbCompositeRenderTile(DEFAULT_STATE, null, 4)(tile(4));
    const modules = renderPipeline!.map((m) => m.module);
    expect(modules[1]).toBe(FilterTransparent);
    expect(JSON.stringify(renderPipeline![0].props)).toContain("t4");
  });

  it("ignores alpha when the file has none", () => {
    const { renderPipeline } = buildRgbCompositeRenderTile(DEFAULT_STATE, null, null)(tile(4));
    expect(renderPipeline!.map((m) => m.module)).not.toContain(FilterTransparent);
    expect(JSON.stringify(renderPipeline![0].props)).not.toContain("t4");
  });
});
