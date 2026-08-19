import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeMultiBandTileLoader,
  setTileErrorHandler,
} from "../tile-loader";

// Minimal stubs — only the fields our code touches.
function makeDevice() {
  return { createTexture: vi.fn() };
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

    await expect(
      loader(image, { device: makeDevice() as never, x: 0, y: 0, signal: new AbortController().signal }),
    ).rejects.toThrow();
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

    await expect(
      loader(image, { device: makeDevice() as never, x: 0, y: 0, signal: new AbortController().signal }),
    ).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("DOES call tileErrorHandler for a genuine non-abort network error", async () => {
    const networkError = new Error("Failed to fetch: https://example.com/file.tif");
    const image = makeImage(async () => { throw networkError; });
    const loader = makeMultiBandTileLoader([1]);
    const handler = vi.fn();
    setTileErrorHandler(handler);

    await expect(
      loader(image, { device: makeDevice() as never, x: 0, y: 0, signal: new AbortController().signal }),
    ).rejects.toThrow();
    expect(handler).toHaveBeenCalledWith(networkError);
  });
});
