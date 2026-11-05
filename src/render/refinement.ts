import type { _Tile2DHeader as Tile2DHeader } from "@deck.gl/geo-layers";

/** Tiles drawn on the previous update. Weak so evicted tiles drop out. */
const drawn = new WeakSet<Tile2DHeader>();

// Same "loaded" test deck.gl's built-in strategies use.
const loaded = (t: Tile2DHeader) => t.isLoaded || Boolean(t.content);

/**
 * deck.gl `refinementStrategy`: a tile stays on screen until the tile
 * replacing it has loaded.
 *
 * deck.gl's "best-available" swaps a pending tile for its nearest loaded
 * *ancestor* and hides everything finer, so zooming out trades the sharp
 * tiles on screen for blurry ones (or holes, if no ancestor is cached).
 * Here, for each pending selected tile, we keep its descendants that were
 * drawn last update, and put the nearest loaded ancestor underneath to fill
 * any gaps (deck.gl draws finer zooms on top). With no ancestor, fall back
 * to any loaded descendants, like "best-available".
 */
export function keepDrawnTiles(tiles: Tile2DHeader[]): void {
  const show = new Set<Tile2DHeader>();
  const showDescendants = (t: Tile2DHeader, onlyDrawn: boolean) => {
    for (const c of t.children ?? []) {
      if (loaded(c) && (!onlyDrawn || drawn.has(c))) show.add(c);
      else showDescendants(c, onlyDrawn);
    }
  };
  for (const t of tiles) {
    if (!t.isSelected) continue;
    if (loaded(t)) {
      show.add(t);
      continue;
    }
    let a = t.parent;
    while (a && !loaded(a)) a = a.parent;
    if (a) show.add(a);
    showDescendants(t, Boolean(a));
  }
  for (const t of tiles) {
    t.isVisible = show.has(t);
    if (t.isVisible) drawn.add(t);
    else drawn.delete(t);
  }
}
