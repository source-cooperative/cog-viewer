import type { GeoTIFF, Overview } from "@developmentseed/geotiff";

type Image = GeoTIFF | Overview;
type Tile = Awaited<ReturnType<Image["fetchTile"]>>;
type Opts = NonNullable<Parameters<Image["fetchTile"]>[2]>;

const windows = new WeakMap<Image, Map<string, Promise<Tile>>>();

/**
 * Auto-stats reads the coarsest overview at the same moment deck.gl draws
 * it, so without sharing every tile downloads twice. While a window is
 * open on `image`, {@link fetchTile} dedupes by (x, y) for every caller.
 * Returns the close function; closing drops the held tiles.
 */
export function openShareWindow(image: Image): () => void {
  const tiles = new Map<string, Promise<Tile>>();
  windows.set(image, tiles);
  return () => {
    if (windows.get(image) === tiles) windows.delete(image);
  };
}

/** `image.fetchTile`, deduped while a share window is open on `image`. */
export function fetchTile(
  image: Image,
  x: number,
  y: number,
  opts: Opts,
): Promise<Tile> {
  const tiles = windows.get(image);
  if (!tiles) return image.fetchTile(x, y, opts);
  const key = `${x},${y}`;
  let p = tiles.get(key);
  if (!p) {
    // ponytail: shared fetch ignores callers' signals, so a tile deck.gl
    // cancels mid-window still finishes. Bounded to the stats level; add
    // refcounted aborts if that ever shows up in the network panel.
    p = image.fetchTile(x, y, { ...opts, signal: undefined });
    tiles.set(key, p);
    p.catch(() => tiles.delete(key));
  }
  return opts.signal ? withSignal(p, opts.signal) : p;
}

function withSignal<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() =>
      signal.removeEventListener("abort", onAbort),
    );
  });
}
