import type { GeoTIFF, Overview } from "@developmentseed/geotiff";

type Image = GeoTIFF | Overview;
type Tile = Awaited<ReturnType<Image["fetchTile"]>>;
type Opts = NonNullable<Parameters<Image["fetchTile"]>[2]>;
type Entry = { p?: Promise<Tile>; takes: number };

const shared = new WeakMap<Image, Map<string, Entry>>();

/**
 * Auto-stats samples tiles from the coarsest overview at the same moment
 * deck.gl draws it, so without sharing those tiles download twice. Marks
 * `coords` of `image` as shared: the first {@link fetchTile} for each one
 * downloads it, the second (stats + map) reuses it and drops it.
 *
 * Returns a release function that drops any tiles still held. Call it when
 * the map can no longer ask for them: `loadGeoTIFF` caches every GeoTIFF for
 * the session, so waiting for the image to be GC'd would hold them forever.
 */
export function shareTiles(
  image: Image,
  coords: Array<[number, number]>,
): () => void {
  const tiles = new Map(coords.map(([x, y]) => [`${x},${y}`, { takes: 0 }]));
  shared.set(image, tiles);
  return () => {
    if (shared.get(image) === tiles) shared.delete(image);
  };
}

/** `image.fetchTile`, deduped for tiles marked by {@link shareTiles}. */
export function fetchTile(
  image: Image,
  x: number,
  y: number,
  opts: Opts,
): Promise<Tile> {
  const tiles = shared.get(image);
  const key = `${x},${y}`;
  const entry = tiles?.get(key);
  if (!tiles || !entry) return image.fetchTile(x, y, opts);
  if (!entry.p) {
    // ponytail: shared fetch ignores callers' signals, so a tile one side
    // cancels still finishes for the other. At most MAX_SAMPLE_TILES tiles.
    entry.p = image.fetchTile(x, y, { ...opts, signal: undefined });
    entry.p.catch(() => tiles.delete(key));
  }
  // ponytail: a tile deck.gl never asks for stays held until the caller
  // releases it; bounded by MAX_SAMPLE_TILES.
  if (++entry.takes >= 2) tiles.delete(key);
  return opts.signal ? withSignal(entry.p, opts.signal) : entry.p;
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
