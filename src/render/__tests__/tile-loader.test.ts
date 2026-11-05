import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeMultiBandTileLoader,
  setTileErrorHandler,
} from "../tile-loader";

// Minimal stubs — only the fields our code touches.
function makeOpts(overrides?: object) {
  return {
    device: { createTexture: vi.fn() } as never,
    pool: null as never, // required by GetTileDataOptions; not read by our loader
    x: 0,
    y: 0,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function makeImage(fetchTileImpl: () => Promise<unknown>) {
  return { fetchTile: fetchTileImpl } as never;
}

afterEach(() => {
  setTileErrorHandler(null);
});

describe("makeMultiBandTileLoader — abort handling", () => {
  it("does not call tileErrorHandler for a bare AbortError", async () => {
    const abortError = new DOMException("The user aborted a request.", "AbortError");
    const image = makeImage(async () => { throw abortError; });
    const loader = makeMultiBandTileLoader([1]);
    const handler = vi.fn();
    setTileErrorHandler(handler);

    await expect(loader(image, makeOpts())).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not call tileErrorHandler when @chunkd/source-http wraps an AbortError as the cause", async () => {
    // @chunkd/source-http wraps ALL errors — including AbortError — in its own
    // SourceError class. The original DOMException ends up on err.cause (via
    // Error's native cause chaining). Our isAbortError check must detect this.
    const abortError = new DOMException("The user aborted a request.", "AbortError");
    const wrappedAbortError = new Error("Failed to fetch: https://example.com/file.tif", {
      cause: abortError,
    });
    const image = makeImage(async () => { throw wrappedAbortError; });
    const loader = makeMultiBandTileLoader([1]);
    const handler = vi.fn();
    setTileErrorHandler(handler);

    await expect(loader(image, makeOpts())).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("DOES call tileErrorHandler for a genuine non-abort network error", async () => {
    const networkError = new Error("Failed to fetch: https://example.com/file.tif");
    const image = makeImage(async () => { throw networkError; });
    const loader = makeMultiBandTileLoader([1]);
    const handler = vi.fn();
    setTileErrorHandler(handler);

    await expect(loader(image, makeOpts())).rejects.toThrow();
    expect(handler).toHaveBeenCalledWith(networkError);
  });
});

describe("makeMultiBandTileLoader — bands past MAX_BAND_SLOTS", () => {
  it("uploads an alpha band that sits at index 5 (R,G,B,NIR,Alpha)", async () => {
    // 1×1 pixel-interleaved tile with 5 samples; alpha (band 5) is 0.
    const array = {
      layout: "pixel-interleaved",
      data: new Uint8Array([10, 20, 30, 40, 0]),
      count: 5,
      width: 1,
      height: 1,
      nodata: null,
    };
    const image = makeImage(async () => ({ array }));
    const createTexture = vi.fn((opts: { data: Uint8Array }) => ({ data: opts.data }));
    const loader = makeMultiBandTileLoader([1, 2, 3, 4, 5]);

    const result = await loader(image, makeOpts({ device: { createTexture } }));

    expect([...result.bands.keys()]).toEqual(["1", "2", "3", "4", "5"]);
    expect(createTexture).toHaveBeenCalledTimes(5);
    expect(Array.from(createTexture.mock.calls[4][0].data)).toEqual([0]);
    expect(result.sampleScale).toBe(255);
  });
});
