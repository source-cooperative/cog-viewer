import { describe, expect, it, vi } from "vitest";
import { fetchTile, openShareWindow } from "../shared-tiles";

function fakeImage() {
  const fetch = vi.fn(async (x: number, y: number) => ({ x, y }));
  return { image: { fetchTile: fetch } as never, fetch };
}

describe("shared tile fetches", () => {
  it("dedupes while a window is open, not after it closes", async () => {
    const { image, fetch } = fakeImage();
    const close = openShareWindow(image);
    const [a, b] = await Promise.all([
      fetchTile(image, 1, 2, {}),
      fetchTile(image, 1, 2, {}),
    ]);
    expect(a).toBe(b);
    expect(fetch).toHaveBeenCalledTimes(1);
    close();
    await fetchTile(image, 1, 2, {});
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("one caller aborting doesn't cancel the other", async () => {
    const { image } = fakeImage();
    const close = openShareWindow(image);
    const ctrl = new AbortController();
    const aborted = fetchTile(image, 0, 0, { signal: ctrl.signal });
    const kept = fetchTile(image, 0, 0, {});
    ctrl.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    await expect(kept).resolves.toEqual({ x: 0, y: 0 });
    close();
  });
});
