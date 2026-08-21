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

  it("rejects NaN / non-integer / non-positive bands", () => {
    expect(parseCogState(new URLSearchParams("bands=foo,bar")).bands).toBeNull();
    expect(parseCogState(new URLSearchParams("bands=")).bands).toBeNull();
    expect(parseCogState(new URLSearchParams("bands=1,,3")).bands).toBeNull();
    expect(parseCogState(new URLSearchParams("bands=0,1")).bands).toBeNull();
    expect(parseCogState(new URLSearchParams("bands=1.5,2")).bands).toBeNull();
    expect(parseCogState(new URLSearchParams("bands=-1,2")).bands).toBeNull();
  });

  it("rejects malformed rescale pairs", () => {
    expect(parseCogState(new URLSearchParams("rescale=foo")).rescale).toBeNull();
    expect(parseCogState(new URLSearchParams("rescale=0")).rescale).toBeNull();
    expect(parseCogState(new URLSearchParams("rescale=0,1,2")).rescale).toBeNull();
    expect(parseCogState(new URLSearchParams("rescale=")).rescale).toBeNull();
  });

  it("clamps opacity to [0, 1] and rejects NaN", () => {
    expect(parseCogState(new URLSearchParams("opacity=abc")).opacity).toBe(1);
    expect(parseCogState(new URLSearchParams("opacity=99")).opacity).toBe(1);
    expect(parseCogState(new URLSearchParams("opacity=-0.5")).opacity).toBe(0);
    expect(parseCogState(new URLSearchParams("opacity=")).opacity).toBe(1);
  });

  it("treats empty nodata as auto, preserves 0 and off", () => {
    expect(parseCogState(new URLSearchParams("nodata=")).nodata).toBeNull();
    expect(parseCogState(new URLSearchParams("nodata=0")).nodata).toBe(0);
    expect(parseCogState(new URLSearchParams("nodata=off")).nodata).toBe("off");
  });

  it("falls back to defaults for invalid basemap and panel", () => {
    expect(parseCogState(new URLSearchParams("basemap=hotpink")).basemap).toBe(
      "auto",
    );
    expect(parseCogState(new URLSearchParams("panel=maybe")).panel).toBe(
      "closed",
    );
  });

  it("parses gamma; defaults to 1; rejects non-positive / NaN", () => {
    expect(parseCogState(new URLSearchParams()).gamma).toBe(1);
    expect(parseCogState(new URLSearchParams("gamma=2.2")).gamma).toBe(2.2);
    expect(parseCogState(new URLSearchParams("gamma=0")).gamma).toBe(1);
    expect(parseCogState(new URLSearchParams("gamma=-1")).gamma).toBe(1);
    expect(parseCogState(new URLSearchParams("gamma=abc")).gamma).toBe(1);
  });

  it("parses viewport zoom/lat/lon; defaults to null when absent", () => {
    expect(parseCogState(new URLSearchParams()).zoom).toBeNull();
    expect(parseCogState(new URLSearchParams()).latitude).toBeNull();
    expect(parseCogState(new URLSearchParams()).longitude).toBeNull();
    const p = new URLSearchParams("zoom=8.5&lat=40.123456&lon=-74.654321");
    const s = parseCogState(p);
    expect(s.zoom).toBe(8.5);
    expect(s.latitude).toBe(40.123456);
    expect(s.longitude).toBe(-74.654321);
  });

  it("parses labelsAbove; defaults true; only 'below' flips it", () => {
    expect(parseCogState(new URLSearchParams()).labelsAbove).toBe(true);
    expect(parseCogState(new URLSearchParams("labels=below")).labelsAbove).toBe(
      false,
    );
    expect(parseCogState(new URLSearchParams("labels=above")).labelsAbove).toBe(
      true,
    );
    expect(parseCogState(new URLSearchParams("labels=bogus")).labelsAbove).toBe(
      true,
    );
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

  it("serializes and round-trips viewport zoom/lat/lon", () => {
    const original = new URLSearchParams("zoom=8.5&lat=40.123456&lon=-74.654321");
    const s = parseCogState(original);
    const out = serializeCogState(s);
    expect(out.get("zoom")).toBe("8.5");
    expect(out.get("lat")).toBe("40.123456");
    expect(out.get("lon")).toBe("-74.654321");
    expect(parseCogState(out)).toEqual(s);
  });

  it("omits viewport params when null", () => {
    const s = parseCogState(new URLSearchParams("url=https://x.tif"));
    const out = serializeCogState(s);
    expect(out.has("zoom")).toBe(false);
    expect(out.has("lat")).toBe(false);
    expect(out.has("lon")).toBe(false);
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
      basemap: "auto",
      panel: "closed",
      gamma: 1,
      labelsAbove: true,
      stretch: "linear",
      zoom: null,
      latitude: null,
      longitude: null,
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
      basemap: "auto",
      panel: "closed",
      gamma: 1,
      labelsAbove: true,
      stretch: "linear",
      zoom: null,
      latitude: null,
      longitude: null,
    });
    expect(out.toString()).toBe("");
  });

  it("emits labels=below only when labelsAbove is false", () => {
    const base = {
      url: null,
      mode: null,
      bands: null,
      rescale: null,
      colormap: null,
      nodata: null,
      opacity: 1,
      basemap: "auto" as const,
      panel: "closed" as const,
      gamma: 1,
      stretch: "linear" as const,
      zoom: null,
      latitude: null,
      longitude: null,
    };
    expect(
      serializeCogState({ ...base, labelsAbove: true }).toString(),
    ).toBe("");
    expect(
      serializeCogState({ ...base, labelsAbove: false }).toString(),
    ).toBe("labels=below");
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
