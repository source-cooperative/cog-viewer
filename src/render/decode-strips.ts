import type { Compression } from "@cogeotiff/core";
import { Predictor, SampleFormat, TiffTag } from "@cogeotiff/core";
import type {
  DecodedPixels,
  DecoderMetadata,
  GeoTIFF,
  RasterTypedArray,
} from "@developmentseed/geotiff";
import { DECODER_REGISTRY } from "@developmentseed/geotiff";

export type DecodedNonTiled = {
  /** One typed array per band, row-major, length = width * height. */
  bands: RasterTypedArray[];
  width: number;
  height: number;
  samplesPerPixel: number;
  nodata: number | null;
};

/** Injectable decoder for testing. Mirrors the upstream `decode` signature. */
export type StripDecoder = (
  bytes: ArrayBuffer,
  compression: Compression,
  metadata: DecoderMetadata,
) => Promise<DecodedPixels | ArrayBuffer>;

/**
 * Production decoder. The upstream `@developmentseed/geotiff` package does
 * not re-export its internal `decode()` helper, so we reproduce the dispatch
 * here using the public `DECODER_REGISTRY`. Predictor handling is
 * intentionally omitted because `applyPredictor` is also internal — if a
 * file with a non-None Predictor is encountered we throw rather than
 * silently produce wrong pixels.
 */
const defaultDecoder: StripDecoder = async (bytes, compression, metadata) => {
  const loader = DECODER_REGISTRY.get(compression);
  if (!loader) {
    throw new Error(`Unsupported compression: ${compression}`);
  }
  const decoder = await loader();
  const result = await decoder(bytes, metadata);
  if (result instanceof ArrayBuffer) {
    return {
      layout: "pixel-interleaved",
      data: toTypedArray(result, metadata),
    };
  }
  return result;
};

/**
 * Decode every strip of a stripped GeoTIFF and stitch them into one
 * typed array per band. Throws if `geotiff.isTiled` is true.
 */
export async function decodeStrips(
  geotiff: GeoTIFF,
  opts: { signal: AbortSignal; decoder?: StripDecoder } = {
    signal: new AbortController().signal,
  },
): Promise<DecodedNonTiled> {
  if (geotiff.isTiled) {
    throw new Error("decodeStrips called on a tiled GeoTIFF");
  }

  const { width, height, count: samplesPerPixel, cachedTags, nodata } = geotiff;
  const tags = geotiff.image.tags;
  const stripByteCounts = tags.get(TiffTag.StripByteCounts);
  const rowsPerStripTag = tags.get(TiffTag.RowsPerStrip);
  if (!stripByteCounts || !rowsPerStripTag) {
    throw new Error("Stripped TIFF is missing StripByteCounts or RowsPerStrip");
  }
  const rowsPerStrip = Number(rowsPerStripTag.value);
  const stripCount = stripByteCounts.count;

  // Inline the upstream uniqueness check (`getUniqueSampleFormat` is
  // not exported).
  const sampleFormat = cachedTags.sampleFormat[0];
  const bitsPerSample = cachedTags.bitsPerSample[0];
  if (sampleFormat === undefined || bitsPerSample === undefined) {
    throw new Error("SampleFormat or BitsPerSample is empty");
  }

  // Predictor is applied AFTER decoding in upstream's `decode()`, which we
  // can't reuse because it isn't re-exported. Rather than silently produce
  // wrong pixels for files with a non-None predictor (Horizontal=2 is
  // common with LZW/Deflate), fail loud and document the limitation.
  if (cachedTags.predictor && cachedTags.predictor !== Predictor.None) {
    throw new Error(
      `Predictor ${cachedTags.predictor} is not supported for non-tiled GeoTIFFs. Convert with gdal_translate -of COG.`,
    );
  }

  // Allocate one full-image typed array per band, then fill row ranges
  // as each strip decodes. Choosing the typed-array constructor from
  // the first decoded strip avoids hand-mapping (sampleFormat,
  // bitsPerSample) → Ctor.
  const decoder = opts.decoder ?? defaultDecoder;
  let bands: RasterTypedArray[] | null = null;
  let rowsCompleted = 0;

  for (let i = 0; i < stripCount; i++) {
    if (opts.signal.aborted) {
      throw new DOMException("decodeStrips aborted", "AbortError");
    }
    const stripHeight = Math.min(rowsPerStrip, height - rowsCompleted);

    const fetched = await geotiff.image.getStrip(i, { signal: opts.signal });
    if (!fetched) {
      rowsCompleted += stripHeight;
      continue;
    }
    const decoderMetadata: DecoderMetadata = {
      sampleFormat,
      bitsPerSample,
      samplesPerPixel,
      width,
      height: stripHeight,
      predictor: cachedTags.predictor,
      planarConfiguration: cachedTags.planarConfiguration,
    };
    // `getStrip` does not return a `compression` field; pull it from
    // the cached tags instead.
    const decoded = await decoder(
      fetched.bytes,
      cachedTags.compression,
      decoderMetadata,
    );

    // Normalize whatever the decoder returned into per-band typed
    // arrays for this strip.
    const stripBands: RasterTypedArray[] = normalizeDecoded(
      decoded,
      width,
      stripHeight,
      samplesPerPixel,
    );

    if (bands === null) {
      // Allocate the full output buffers now we know the dtype.
      bands = stripBands.map((band) => {
        const Ctor = band.constructor as new (n: number) => RasterTypedArray;
        return new Ctor(width * height);
      });
    }

    const rowOffset = rowsCompleted * width;
    for (let b = 0; b < bands.length; b++) {
      bands[b].set(stripBands[b] as never, rowOffset);
    }
    rowsCompleted += stripHeight;
  }

  if (bands === null) {
    throw new Error("Stripped TIFF decoded to zero strips");
  }

  return {
    bands,
    width,
    height,
    samplesPerPixel,
    nodata,
  };
}

/** Convert a single strip's decoder output into per-band typed arrays. */
function normalizeDecoded(
  decoded: DecodedPixels | ArrayBuffer,
  width: number,
  height: number,
  samplesPerPixel: number,
): RasterTypedArray[] {
  // Some decoders (deflate, none) return raw bytes that need to be
  // wrapped as the sample-format-appropriate typed array. We assume
  // uint8 here for the byte-buffer case because the only call sites
  // that hit this branch are uncompressed/deflate, and the upstream
  // `decode()` handles non-uint8 widening for us. If a raw
  // ArrayBuffer arrives, treat it as a single Uint8Array band per
  // call site convention.
  if (decoded instanceof ArrayBuffer) {
    return [new Uint8Array(decoded)];
  }
  if (decoded.layout === "band-separate") {
    return decoded.bands;
  }
  // Pixel-interleaved: de-interleave into per-band arrays.
  const pixels = width * height;
  const out: RasterTypedArray[] = [];
  const src = decoded.data;
  const Ctor = src.constructor as new (n: number) => RasterTypedArray;
  for (let b = 0; b < samplesPerPixel; b++) {
    const band = new Ctor(pixels);
    for (let i = 0; i < pixels; i++) {
      band[i] = src[i * samplesPerPixel + b] as number;
    }
    out.push(band);
  }
  return out;
}

/**
 * Convert a raw ArrayBuffer of pixel data into a typed array based on the
 * sample format and bits per sample. Used for codecs that return raw bytes
 * (None, Deflate). Mirrors upstream's internal `toTypedArray`.
 */
function toTypedArray(
  buffer: ArrayBuffer,
  metadata: DecoderMetadata,
): RasterTypedArray {
  const { sampleFormat, bitsPerSample } = metadata;
  switch (sampleFormat) {
    case SampleFormat.Uint:
      switch (bitsPerSample) {
        case 8:
          return new Uint8Array(buffer);
        case 16:
          return new Uint16Array(buffer);
        case 32:
          return new Uint32Array(buffer);
      }
      break;
    case SampleFormat.Int:
      switch (bitsPerSample) {
        case 8:
          return new Int8Array(buffer);
        case 16:
          return new Int16Array(buffer);
        case 32:
          return new Int32Array(buffer);
      }
      break;
    case SampleFormat.Float:
      switch (bitsPerSample) {
        case 32:
          return new Float32Array(buffer);
        case 64:
          return new Float64Array(buffer);
      }
      break;
  }
  throw new Error(
    `Unsupported sample format/depth: SampleFormat=${sampleFormat}, BitsPerSample=${bitsPerSample}`,
  );
}
