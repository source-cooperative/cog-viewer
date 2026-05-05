import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parseCogState, serializeCogState, useCogState } from "../useCogState";

describe("parseCogState", () => {
  it("returns nulls for empty params", () => {
    const s = parseCogState(new URLSearchParams());
    expect(s.url).toBeNull();
    expect(s.mode).toBeNull();
    expect(s.bands).toBeNull();
    expect(s.rescale).toBeNull();
    expect(s.opacity).toBe(1);
  });

  it("parses url, mode, bands, rescale", () => {
    const p = new URLSearchParams(
      "url=https://x/y.tif&mode=rgb&bands=4,3,2&rescale=0,3000;0,3000;0,3000",
    );
    const s = parseCogState(p);
    expect(s.url).toBe("https://x/y.tif");
    expect(s.mode).toBe("rgb");
    expect(s.bands).toEqual([4, 3, 2]);
    expect(s.rescale).toEqual([
      [0, 3000],
      [0, 3000],
      [0, 3000],
    ]);
  });

  it("parses single-band rescale as one pair", () => {
    const p = new URLSearchParams("rescale=0,255");
    expect(parseCogState(p).rescale).toEqual([[0, 255]]);
  });

  it("parses nodata special values", () => {
    expect(parseCogState(new URLSearchParams("nodata=off")).nodata).toBe("off");
    expect(parseCogState(new URLSearchParams("nodata=-9999")).nodata).toBe(-9999);
    expect(parseCogState(new URLSearchParams()).nodata).toBeNull();
  });

  it("parses opacity with default 1", () => {
    expect(parseCogState(new URLSearchParams()).opacity).toBe(1);
    expect(parseCogState(new URLSearchParams("opacity=0.5")).opacity).toBe(0.5);
  });

  it("ignores invalid mode", () => {
    expect(parseCogState(new URLSearchParams("mode=bogus")).mode).toBeNull();
  });
});

describe("serializeCogState", () => {
  it("round-trips a populated state", () => {
    const original = new URLSearchParams(
      "url=https://x.tif&mode=rgb&bands=4,3,2&rescale=0,3000;0,3000;0,3000&opacity=0.8",
    );
    const s = parseCogState(original);
    const out = serializeCogState(s);
    expect(parseCogState(out)).toEqual(s);
  });

  it("omits null fields", () => {
    const out = serializeCogState({
      url: "https://x.tif",
      mode: null,
      bands: null,
      rescale: null,
      colormap: null,
      nodata: null,
      opacity: 1,
      colorspace: null,
      basemap: "auto",
    });
    expect(out.toString()).toBe("url=https%3A%2F%2Fx.tif");
  });

  it("omits opacity when 1", () => {
    const out = serializeCogState({
      url: null,
      mode: null,
      bands: null,
      rescale: null,
      colormap: null,
      nodata: null,
      opacity: 1,
      colorspace: null,
      basemap: "auto",
    });
    expect(out.toString()).toBe("");
  });
});

describe("useCogState subscription", () => {
  it("re-renders when update() is called", () => {
    window.history.replaceState(null, "", "/");
    const { result } = renderHook(() => useCogState());
    expect(result.current[0].url).toBeNull();
    act(() => result.current[1]({ url: "https://x.tif" }));
    expect(result.current[0].url).toBe("https://x.tif");
  });
});
