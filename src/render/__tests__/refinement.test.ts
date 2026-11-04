import { describe, expect, it } from "vitest";
import { keepDrawnTiles } from "../refinement";

type T = {
  id: string;
  isLoaded: boolean;
  content: unknown;
  isSelected: boolean;
  isVisible: boolean;
  parent: T | null;
  children: T[];
};
const tile = (id: string, isLoaded: boolean, parent: T | null = null): T => {
  const t: T = { id, isLoaded, content: null, isSelected: false, isVisible: false, parent, children: [] };
  parent?.children.push(t);
  return t;
};
const run = (tiles: T[], selected: T[]) => {
  for (const t of tiles) t.isSelected = selected.includes(t);
  keepDrawnTiles(tiles as never);
  return tiles.filter((t) => t.isVisible).map((t) => t.id);
};

describe("keepDrawnTiles", () => {
  it("keeps drawn fine tiles over a coarse ancestor until the replacement loads", () => {
    const root = tile("z0", true);
    const mid = tile("z1", false, root);
    const fine = tile("z2", true, mid);
    const tiles = [root, mid, fine];

    expect(run(tiles, [fine])).toEqual(["z2"]); // zoomed in: fine drawn
    expect(run(tiles, [mid])).toEqual(["z0", "z2"]); // zoom out, z1 pending: keep z2, z0 fills gaps
    mid.isLoaded = true;
    expect(run(tiles, [mid])).toEqual(["z1"]); // replacement loaded: drop the rest
  });

  it("doesn't resurrect descendants that weren't drawn when an ancestor covers", () => {
    const root = tile("z0", true);
    const mid = tile("z1", false, root);
    const fine = tile("z2", true, mid);
    expect(run([root, mid, fine], [mid])).toEqual(["z0"]);
  });

  it("falls back to loaded descendants when no ancestor is loaded", () => {
    const mid = tile("z1", false);
    const fine = tile("z2", true, mid);
    expect(run([mid, fine], [mid])).toEqual(["z2"]);
  });
});
