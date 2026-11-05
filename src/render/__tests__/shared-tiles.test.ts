import { describe, expect, it, vi } from "vitest";
import { fetchTile, shareTiles } from "../shared-tiles";

function fakeImage() {
  const fetch = vi.fn(async (x: number, y: number) => ({ x, y }));
  return { image: { fetchTile: fetch } as never, fetch };
}

describe("shared tile fetches", () => {
  it("shares a marked tile once, then lets go of it", async () => {
    const { image, fetch } = fakeImage();
    shareTiles(image, [[1, 2]]);
    const a = await fetchTile(image, 1, 2, {}); // stats
    const b = await fetchTile(image, 1, 2, {}); // map, after stats finished
    expect(a).toBe(b);
    expect(fetch).toHaveBeenCalledTimes(1);
    await fetchTile(image, 1, 2, {}); // later refetch isn't held
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("doesn't share unmarked tiles", async () => {
    const { image, fetch } = fakeImage();
    shareTiles(image, [[0, 0]]);
    await fetchTile(image, 5, 5, {});
    await fetchTile(image, 5, 5, {});
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("release drops tiles nobody took a second time", async () => {
    const { image, fetch } = fakeImage();
    const release = shareTiles(image, [[0, 0]]);
    await fetchTile(image, 0, 0, {}); // stats
    release(); // COG switched before the map asked
    await fetchTile(image, 0, 0, {});
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("a stale release doesn't drop a newer share", async () => {
    const { image, fetch } = fakeImage();
    const stale = shareTiles(image, [[0, 0]]);
    shareTiles(image, [[0, 0]]);
    stale();
    await fetchTile(image, 0, 0, {});
    await fetchTile(image, 0, 0, {});
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("one caller aborting doesn't cancel the other", async () => {
    const { image } = fakeImage();
    shareTiles(image, [[0, 0]]);
    const ctrl = new AbortController();
    const aborted = fetchTile(image, 0, 0, { signal: ctrl.signal });
    const kept = fetchTile(image, 0, 0, {});
    ctrl.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    await expect(kept).resolves.toEqual({ x: 0, y: 0 });
  });
});
