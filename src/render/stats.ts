import { TiffTag } from "@cogeotiff/core";
import type { GeoTIFF } from "@developmentseed/geotiff";

/** Read SamplesPerPixel from the COG's primary IFD tags. */
export function readBandCount(tiff: GeoTIFF): number | null {
  const v = tiff.image.value(TiffTag.SamplesPerPixel);
  return typeof v === "number" && v > 0 ? v : null;
}

export type AutoStats = {
  /** Per-band 1-indexed [min, max] from the COG. Null when stats are unknown. */
  perBand: Map<number, [number, number]> | null;
  /** A reasonable global min/max to use when no rescale override is set.
   * Derived from the average of per-band stats, so RGB renders with one
   * shared range without favoring a single channel. */
  global: [number, number] | null;
};

const NULL_STATS: AutoStats = { perBand: null, global: null };

function average(ranges: [number, number][]): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const [a, b] of ranges) {
    lo += a;
    hi += b;
  }
  return [lo / ranges.length, hi / ranges.length];
}

/** Read per-band min/max from GDAL_METADATA tags if the COG carries them. */
function fromGdalMetadata(tiff: GeoTIFF): AutoStats {
  const meta = tiff.gdalMetadata;
  if (!meta || meta.bandStatistics.size === 0) return NULL_STATS;
  const perBand = new Map<number, [number, number]>();
  for (const [band, stats] of meta.bandStatistics) {
    if (stats.min !== null && stats.max !== null) {
      perBand.set(band, [stats.min, stats.max]);
    }
  }
  if (perBand.size === 0) return NULL_STATS;
  return { perBand, global: average([...perBand.values()]) };
}

/** Sample the coarsest overview's (0,0) tile and compute per-band min/max. */
async function fromCoarsestOverview(
  tiff: GeoTIFF,
  signal: AbortSignal,
): Promise<AutoStats> {
  const ovs = tiff.overviews;
  if (ovs.length === 0) return NULL_STATS;
  const coarsest = ovs[ovs.length - 1];
  const tile = await coarsest.fetchTile(0, 0, { signal, boundless: false });
  if (signal.aborted) return NULL_STATS;
  const arr = tile.array;
  const perBand = new Map<number, [number, number]>();
  for (let b = 0; b < arr.count; b++) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    if (arr.layout === "band-separate") {
      const data = arr.bands[b];
      for (let i = 0; i < data.length; i++) {
        const v = data[i] as number;
        if (arr.nodata !== null && v === arr.nodata) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    } else {
      const data = arr.data;
      for (let i = b; i < data.length; i += arr.count) {
        const v = data[i] as number;
        if (arr.nodata !== null && v === arr.nodata) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (Number.isFinite(min) && Number.isFinite(max) && min < max) {
      perBand.set(b + 1, [min, max]);
    }
  }
  if (perBand.size === 0) return NULL_STATS;
  return { perBand, global: average([...perBand.values()]) };
}

/** Compute auto-stats for a GeoTIFF: try GDAL_METADATA first, then sample
 * the coarsest overview. Caller is responsible for guarding against
 * stale results when the URL changes. */
export async function computeAutoStats(
  tiff: GeoTIFF,
  signal: AbortSignal,
): Promise<AutoStats> {
  const fromMeta = fromGdalMetadata(tiff);
  if (fromMeta.perBand) return fromMeta;
  return fromCoarsestOverview(tiff, signal);
}
