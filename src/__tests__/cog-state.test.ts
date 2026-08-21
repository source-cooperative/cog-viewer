import { describe, expect, it } from "vitest";
import { parseCogState, serializeCogState } from "../state/useCogState";

const base = {
  mode: null,
  bands: null,
  rescale: null,
  colormap: null,
  nodata: null,
  opacity: 1,
  basemap: "auto" as const,
  panel: "closed" as const,
  gamma: 1,
  labelsAbove: true,
  stretch: "linear" as const,
  zoom: null,
  latitude: null,
  longitude: null,
};

describe("parseCogState — urls", () => {
  it("returns empty urls when no url param is present", () => {
    const state = parseCogState(new URLSearchParams(""));
    expect(state.urls).toEqual([]);
  });

  it("returns single-element array for one url param", () => {
    const state = parseCogState(new URLSearchParams("url=https://example.com/a.tif"));
    expect(state.urls).toEqual(["https://example.com/a.tif"]);
  });

  it("collects all values when url param is repeated", () => {
    const p = new URLSearchParams();
    p.append("url", "https://example.com/B04.tif");
    p.append("url", "https://example.com/B03.tif");
    p.append("url", "https://example.com/B02.tif");
    expect(parseCogState(p).urls).toEqual([
      "https://example.com/B04.tif",
      "https://example.com/B03.tif",
      "https://example.com/B02.tif",
    ]);
  });
});

describe("serializeCogState — urls", () => {
  it("omits url params when urls is empty", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = serializeCogState({ ...base, urls: [] } as any);
    expect(p.getAll("url")).toEqual([]);
  });

  it("produces one url param for a single url", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = serializeCogState({ ...base, urls: ["https://example.com/a.tif"] } as any);
    expect(p.getAll("url")).toEqual(["https://example.com/a.tif"]);
  });

  it("produces multiple url params for multiple urls", () => {
    const p = serializeCogState({
      ...base,
      urls: ["https://example.com/B04.tif", "https://example.com/B03.tif"],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(p.getAll("url")).toEqual([
      "https://example.com/B04.tif",
      "https://example.com/B03.tif",
    ]);
  });

  it("roundtrips multi-url state through parse and serialize", () => {
    const original = new URLSearchParams();
    original.append("url", "https://example.com/B04.tif");
    original.append("url", "https://example.com/B02.tif");
    const state = parseCogState(original);
    const roundtripped = parseCogState(serializeCogState(state));
    expect(roundtripped.urls).toEqual(state.urls);
  });
});
