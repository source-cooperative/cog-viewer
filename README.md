# cog-viewer

A static, browser-only viewer for [Cloud Optimized GeoTIFFs][cog]. Paste a URL,
inspect bands, swap colormaps, share the result as a link. Inspired by
[marblecutter-virtual][marblecutter] but with no server: the COG is fetched
and decoded entirely in the browser.

Built on [`@developmentseed/deck.gl-geotiff`][deck-gl-geotiff] and
[`@developmentseed/deck.gl-raster`][deck-gl-raster] for tiled COG fetching
and GPU-side rendering. Stripped (non-tiled) TIFFs — which that stack can't
read tile-by-tile — fall back to a whole-file read via [`geotiff.js`][geotiffjs];
see [Non-tiled TIFFs](#non-tiled-stripped-tiffs).

[cog]: https://www.cogeo.org/
[marblecutter]: https://github.com/sethfitz/marblecutter-virtual
[deck-gl-geotiff]: https://github.com/developmentseed/deck.gl-raster/tree/main/packages/deck.gl-geotiff
[deck-gl-raster]: https://github.com/developmentseed/deck.gl-raster/tree/main/packages/deck.gl-raster
[geotiffjs]: https://github.com/geotiffjs/geotiff.js

## Usage

Open the app with a COG URL:

    https://your-host/?url=https://example.com/cog.tif

The COG must be served with CORS (`Access-Control-Allow-Origin`) and
`Content-Range` exposed for byte-range requests; almost any S3 / Cloudflare
public bucket works. Without `?url=`, an empty-state card offers paste,
drag-and-drop, and a curated examples list.

### URL parameters

The full app state lives in the URL, so any view is shareable.

| Param      | Example                | Notes                                                                |
| ---------- | ---------------------- | -------------------------------------------------------------------- |
| `url`      | `https://…/cog.tif`    | The COG to render. Required (or use the empty state).                |
| `mode`     | `rgb` \| `single`      | Auto-picked from band count when absent.                             |
| `bands`    | `4,3,2`                | RGB mode: R/G/B band indexes. Single mode: one index.                |
| `rescale`  | `0,3000` or `0,3000;0,3000;0,3000` | Single-band: one `min,max`. RGB: one (broadcast) or three pairs (per-channel). |
| `colormap` | `viridis`              | Single-band only. 96 named colormaps from deck.gl-raster.            |
| `nodata`   | `-9999` \| `off`       | Override of the COG's declared nodata.                               |
| `gamma`    | `1.2`                  | Power-law gamma, `> 0`. `1` = off.                                   |
| `opacity`  | `0.7`                  | Layer opacity, `0..1`.                                               |
| `basemap`  | `auto` \| `light` \| `dark` \| `satellite` \| `off` | Default `auto` (follows `prefers-color-scheme`). |
| `panel`    | `open` \| `closed`     | Whether the Options panel starts expanded.                           |

## Rendering pipeline

The custom render path is always active (it gives stable layer ids, so
swapping bands / colormap / mode never refetches tiles).

1. **Fetch.** A custom `getTileData` calls `image.fetchTile(x, y)` once per
   tile and uploads each of the first up to 4 bands as its own r-channel
   GPU texture (`r8unorm` / `r16float` / `r32float` matching the COG's
   sample format).
2. **Composite.** `CompositeBands` from `deck.gl-raster/gpu-modules`
   swizzles those band textures into RGBA at draw time, mapping the user's
   selected indexes to output channels. Re-mapping requires only a new
   draw — no fetch.
3. **Rescale, curve, gamma, colormap, nodata.** Optional modules layer on
   top: `PerBandLinearRescale` (RGB) or `LinearRescale` (single) for
   value normalization, `LogStretch` / `SqrtStretch` for non-linear
   distribution curves, `Gamma` for power-law correction, `Colormap`
   (single-band only) for color lookup against a 2D-array sprite of 96
   named colormaps, `FilterNoDataVal` to discard nodata. The shader-module
   sources for the custom modules are in `src/render/shader-modules.ts`.

The first render after a URL load fetches once. Every subsequent control
change — mode toggle, band swap, rescale, colormap pick, nodata, opacity,
basemap, panel collapse — is GPU-only.

### Non-tiled (stripped) TIFFs

`@developmentseed/geotiff` only reads *tiled* images — `image.fetchTile()`
expects `TileOffsets`, which stripped TIFFs don't have (its non-tiled
`GeoTIFFLayer` is unexported and still a stub; see
[deck.gl-raster#573][issue-573]). Some valid COGs are nonetheless stripped:
small enough that GDAL writes a single strip and omits `TileWidth`/`TileLength`.

When `tiff.isTiled` is false, the app branches to a whole-file path:

1. **Read.** The entire file is fetched once and decoded with
   [`geotiff.js`][geotiffjs] (`readRasters`, which handles stripped layouts),
   yielding one typed array per band — see `src/cog/read-strips.ts`. A size
   guard (max 8192 px/side, ~64M samples) rejects oversized files *before*
   download, surfacing a message instead.
2. **Reproject.** `src/cog/reproject.ts` builds the pixel↔CRS (affine
   geotransform) and CRS↔WGS84 (proj4) functions that `RasterLayer` needs,
   replicating the helper `deck.gl-geotiff` keeps internal.
3. **Render.** Bands upload as the same per-band r-channel textures and feed
   the **same** `renderTile` pipeline (composite → rescale → curve → gamma →
   colormap → nodata) through `@developmentseed/deck.gl-raster`'s non-tiled
   `RasterLayer`. All render controls work identically; reprojection runs on
   the GPU via an adaptive mesh.

A neutral toast notes when an image is rendered in this whole-file mode, and
the metadata panel shows `Tiles: stripped (whole-file)`.

[issue-573]: https://github.com/developmentseed/deck.gl-raster/issues/573

### Auto behavior

- **Mode.** If no `?mode=` is set and the COG has fewer than 2 bands, the
  app auto-fills `mode=single&bands=1` so single-band COGs render through
  a colormap rather than as raw grayscale.
- **Rescale.** If no `?rescale=` is set, the app reads per-band
  `STATISTICS_MINIMUM` / `STATISTICS_MAXIMUM` from `GDAL_METADATA`. If
  those are absent it samples the coarsest overview's first tile and
  computes per-band min/max (for stripped TIFFs, from the whole-image
  arrays already in memory). The result populates the Rescale form fields
  (labeled "auto") and is averaged into a single global range for
  `LinearRescale`.
- **Band names.** Per-band `<Item name="DESCRIPTION" sample="N">…</Item>`
  entries in `GDAL_METADATA` (and the `BAND_NAME` alias) become labels in
  the band picker — `1 — B04`, etc.
- **Fit bounds.** The first metadata load triggers a one-shot `fitBounds`
  to the COG's geographic extent (derived from the reprojected bbox corners
  on the stripped path).

## Develop

    pnpm install
    pnpm dev      # vite dev server
    pnpm test     # vitest
    pnpm build    # static bundle in dist/

Tested with Node ≥ 20 and pnpm 10. The build is a fully static SPA;
deploy to any static host.

## Deploy

`.github/workflows/deploy.yml` publishes to GitHub Pages on every push
to `main` (`https://source-cooperative.github.io/cog-viewer/`). The
production build sets `base: /cog-viewer/`; the dev server still mounts
at `/`.

To enable: in **Settings → Pages**, set "Build and deployment → Source"
to "GitHub Actions". The workflow handles the rest.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  React app (Vite)                                           │
│                                                             │
│  ┌──────────────────┐    ┌────────────────────────────┐     │
│  │ useCogState      │◄───┤ Options panel              │     │
│  │ ?url, ?mode, …   │    │ basemap, mode, bands,      │     │
│  │ via              │    │ rescale, colormap, nodata, │     │
│  │ useSyncExternal- │    │ opacity                    │     │
│  │ Store + replace- │    └────────────────────────────┘     │
│  │ State            │                                       │
│  └────────┬─────────┘                                       │
│           ▼                                                 │
│  ┌──────────────────┐                                       │
│  │ loadGeoTIFF()    │  (CorsSafeSourceHttp + chunked view;  │
│  │ src/cog/         │   works around the upstream           │
│  │   load-geotiff   │   206-Content-Length bug)             │
│  └────────┬─────────┘                                       │
│           ▼                                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ MapLibre <Map>                                       │   │
│  │  • basemap from resolveBasemap()                     │   │
│  │  • <DeckGLOverlay layers=[ tiled ? COGLayer          │   │
│  │                            : RasterLayer ]>          │   │
│  │     tiled:  getTileData → fetch tile, upload up to 4 │   │
│  │             r-channel textures                       │   │
│  │     strip:  read-strips → whole-file bands → same    │   │
│  │             textures; reproject.ts → RasterLayer     │   │
│  │     renderTile (shared) → CompositeBands →           │   │
│  │       LinearRescale → Colormap? → FilterNoDataVal    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

Source layout:

| Path                                 | Role                                                       |
| ------------------------------------ | ---------------------------------------------------------- |
| `src/App.tsx`                        | Map shell, tiled/non-tiled routing, GeoTIFF lifecycle.     |
| `src/state/useCogState.ts`           | URL search-params hook (parse / serialize / subscribe).    |
| `src/render/tile-loader.ts`          | `buildMultiBandTileData` + tiled / whole-image loaders: per-band r-channel textures. |
| `src/render/render-pipeline.ts`      | RGB and single-band `renderTile` builders (shared by both paths). |
| `src/render/shader-modules.ts`       | Custom luma.gl modules: per-band rescale, log/sqrt stretch, gamma. |
| `src/render/stats.ts`                | `readBandNames`, `computeAutoStats` (tiled), `computeAutoStatsFromArrays` (whole-image). |
| `src/cog/load-geotiff.ts`            | CORS-safe `loadGeoTIFF()` with in-flight dedupe.           |
| `src/cog/read-strips.ts`             | Whole-file reader (geotiff.js) for non-tiled TIFFs + size guard. |
| `src/cog/reproject.ts`               | Pixel↔CRS↔WGS84 functions + geographic bounds for `RasterLayer`. |
| `src/components/ControlsPanel.tsx`   | Options panel (basemap + render controls).                 |
| `src/components/EmptyState.tsx`      | Paste / drop / examples landing card.                      |
| `src/basemaps.ts`                    | `resolveBasemap()` — maps `Basemap` to a MapLibre style.   |
| `src/data/examples.ts`               | Curated CORS-enabled COG URLs.                             |

## Known limitations

- **Bands cap at 4.** `CompositeBands` has 4 fixed shader slots, so the
  band picker hides bands 5+. For COGs like raw Sentinel-2 (13 bands), use
  a JP2-extracted subset or wait for a dynamic-cache extension.
- **Antimeridian.** `RasterReprojector` produces a single mesh in source
  CRS without world-copy duplication, so a COG centered near 180° appears
  only once and is clipped where the basemap repeats. Fixing this needs
  upstream work in `@developmentseed/deck.gl-raster`.
- **No hillshade / band-math expressions.** Each needs a custom luma.gl
  shader module; deferred. Hillshade requires neighbor sampling on a
  single-band DEM; band-math needs either a fixed preset list (NDVI,
  NDWI, …) or a small expression DSL.
- **Non-tiled TIFFs are size-capped and read whole.** Stripped images load
  the entire file into memory and upload one full-resolution texture per
  band, so they're limited to 8192 px/side (and ~64M samples); larger ones
  show a message instead of rendering. Their geographic bounds come from the
  four reprojected bbox corners, so `fitBounds` can be slightly off for
  strongly curved projections. No overview pyramid exists, so there's no
  level-of-detail — the full image is always drawn.

## Worked-around upstream bugs

- **`@developmentseed/geotiff` 0.6.1 misreads `Content-Length` of 206
  responses as the file size** when the bucket doesn't expose
  `Content-Range` via CORS, leading to malformed `Range: bytes=START-END`
  headers (`END < START`) on subsequent IFD reads. S3 then ignores the
  range and serves the entire file with status 200 (1.4 GB for the NLCD
  example COG). We work around this by constructing the source ourselves
  via a `CorsSafeSourceHttp` subclass that wipes the bogus
  `metadata.size` after the first 206 — see `src/cog/load-geotiff.ts`.
  Remove once the fix lands upstream.
- **`@developmentseed/geotiff` can't read stripped / single-tile images.**
  `fetchTile` is the only pixel-read path, so non-tiled TIFFs are handled
  out-of-band: read whole with `geotiff.js` and rendered via `RasterLayer`
  with locally rebuilt reprojection functions (`src/cog/read-strips.ts`,
  `src/cog/reproject.ts`). Tracked upstream as
  [deck.gl-raster#573][issue-573]; retire this path and route stripped
  images through the normal `fetchTile` + `COGLayer` flow once it lands.

## Design + plan documents

- [`docs/plans/2026-05-05-cog-viewer-design.md`](./docs/plans/2026-05-05-cog-viewer-design.md)
- [`docs/plans/2026-05-05-cog-viewer.md`](./docs/plans/2026-05-05-cog-viewer.md)
