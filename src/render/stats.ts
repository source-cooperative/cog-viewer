import { TiffTag } from "@cogeotiff/core";
import type { GeoTIFF } from "@developmentseed/geotiff";

/** Read SamplesPerPixel from the COG's primary IFD tags. */
export function readBandCount(tiff: GeoTIFF): number | null {
  const v = tiff.image.value(TiffTag.SamplesPerPixel);
  return typeof v === "number" && v > 0 ? v : null;
}

/**
 * Parse band descriptions from the GDAL_METADATA XML tag. Looks for
 * `<Item name="DESCRIPTION" sample="N">name</Item>` (and a few common
 * aliases) and returns a 1-indexed band → name map. The geotiff package
 * surfaces statistics from this XML but not descriptions, so we re-parse.
 */
export function readBandNames(tiff: GeoTIFF): Map<number, string> | null {
  const xml = tiff.image.value(TiffTag.GdalMetadata);
  if (typeof xml !== "string" || xml.length === 0) return null;
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const out = new Map<number, string>();
  for (const item of Array.from(doc.querySelectorAll("Item"))) {
    const name = item.getAttribute("name");
    const sample = item.getAttribute("sample");
    if (sample === null) continue;
    if (name !== "DESCRIPTION" && name !== "BAND_NAME") continue;
    const text = item.textContent?.trim() ?? "";
    if (!text) continue;
    const idx = parseInt(sample, 10) + 1;
    if (Number.isFinite(idx) && idx > 0) out.set(idx, text);
  }
  return out.size > 0 ? out : null;
}

const HISTOGRAM_BINS = 128;

export type BandStats = {
  min: number;
  max: number;
  /** Bin counts evenly distributed over [min, max]. Length = HISTOGRAM_BINS. */
  histogram: number[];
};

export type AutoStats = {
  /** 1-indexed band → stats map. Null when stats are unknown. */
  perBand: Map<number, BandStats> | null;
  /** A reasonable global stats block to fall back on (averaged min/max,
   * summed histogram bins). */
  global: BandStats | null;
};

const NULL_STATS: AutoStats = { perBand: null, global: null };

function averageStats(stats: BandStats[]): BandStats {
  let lo = 0;
  let hi = 0;
  const summedHistogram = new Array<number>(HISTOGRAM_BINS).fill(0);
  for (const s of stats) {
    lo += s.min;
    hi += s.max;
    for (let i = 0; i < HISTOGRAM_BINS; i++) {
      summedHistogram[i] += s.histogram[i] ?? 0;
    }
  }
  return {
    min: lo / stats.length,
    max: hi / stats.length,
    histogram: summedHistogram,
  };
}

/**
 * Linear-interpolated percentile from a histogram. `p` is in [0, 1]. Used
 * to derive default rescale ranges (typically [0.02, 0.98]) without storing
 * raw samples.
 */
export function percentileFromHistogram(stats: BandStats, p: number): number {
  const total = stats.histogram.reduce((a, b) => a + b, 0);
  if (total === 0) return p < 0.5 ? stats.min : stats.max;
  const target = total * p;
  let acc = 0;
  const range = stats.max - stats.min;
  if (range <= 0) return stats.min;
  const binWidth = range / stats.histogram.length;
  for (let i = 0; i < stats.histogram.length; i++) {
    const count = stats.histogram[i];
    if (acc + count >= target) {
      const fraction = count > 0 ? (target - acc) / count : 0;
      return stats.min + (i + fraction) * binWidth;
    }
    acc += count;
  }
  return stats.max;
}

/** Bin a single band's values into a histogram with `min` / `max` as edges. */
function buildHistogram(
  iter: Iterable<number>,
  min: number,
  max: number,
  nodata: number | null,
): number[] {
  const bins = new Array<number>(HISTOGRAM_BINS).fill(0);
  if (max <= min) return bins;
  const scale = HISTOGRAM_BINS / (max - min);
  for (const v of iter) {
    if (nodata !== null && v === nodata) continue;
    if (!Number.isFinite(v)) continue;
    let idx = Math.floor((v - min) * scale);
    if (idx < 0) idx = 0;
    if (idx >= HISTOGRAM_BINS) idx = HISTOGRAM_BINS - 1;
    bins[idx]++;
  }
  return bins;
}

/** Read per-band min/max from GDAL_METADATA tags if the COG carries them.
 * GDAL stats don't include histograms, so this returns stats with
 * empty bin arrays — the coarsest-overview pass populates them. */
function fromGdalMetadata(tiff: GeoTIFF): AutoStats {
  const meta = tiff.gdalMetadata;
  if (!meta || meta.bandStatistics.size === 0) return NULL_STATS;
  const perBand = new Map<number, BandStats>();
  for (const [band, stats] of meta.bandStatistics) {
    if (stats.min !== null && stats.max !== null) {
      perBand.set(band, {
        min: stats.min,
        max: stats.max,
        histogram: new Array<number>(HISTOGRAM_BINS).fill(0),
      });
    }
  }
  if (perBand.size === 0) return NULL_STATS;
  return { perBand, global: averageStats([...perBand.values()]) };
}

/** Sample the coarsest overview's (0,0) tile to compute per-band min/max
 * and a 128-bin histogram per band. */
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
  const perBand = new Map<number, BandStats>();

  for (let b = 0; b < arr.count; b++) {
    const bandIter = (function* () {
      if (arr.layout === "band-separate") {
        const data = arr.bands[b];
        for (let i = 0; i < data.length; i++) yield data[i] as number;
      } else {
        const data = arr.data;
        for (let i = b; i < data.length; i += arr.count) yield data[i] as number;
      }
    })();

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    const values: number[] = [];
    for (const v of bandIter) {
      if (arr.nodata !== null && v === arr.nodata) continue;
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      values.push(v);
    }
    if (
      Number.isFinite(min) &&
      Number.isFinite(max) &&
      min < max &&
      values.length > 0
    ) {
      perBand.set(b + 1, {
        min,
        max,
        histogram: buildHistogram(values, min, max, arr.nodata),
      });
    }
  }
  if (perBand.size === 0) return NULL_STATS;
  return { perBand, global: averageStats([...perBand.values()]) };
}

/** Compute auto-stats for a GeoTIFF: try GDAL_METADATA for min/max first
 * (cheap), then always sample the coarsest overview to fill in histograms.
 * The histogram pass is a single iteration over a single tile, so doing it
 * unconditionally is fine. Caller guards against stale results. */
export async function computeAutoStats(
  tiff: GeoTIFF,
  signal: AbortSignal,
): Promise<AutoStats> {
  const sampled = await fromCoarsestOverview(tiff, signal);
  if (sampled.perBand) return sampled;
  // Fallback: GDAL stats without histograms when there's no overview pyramid.
  return fromGdalMetadata(tiff);
}
