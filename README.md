# cog-viewer

A static, browser-only viewer for [Cloud Optimized GeoTIFFs][cog]. Paste a URL,
inspect bands, swap colormaps, share the result as a link. Inspired by
[marblecutter-virtual][marblecutter] but with no server: the COG is fetched
and decoded entirely in the browser.

Built on [`@developmentseed/deck.gl-geotiff`][deck-gl-geotiff] and
[`@developmentseed/deck.gl-raster`][deck-gl-raster] for tiled COG fetching
and GPU-side rendering.

[cog]: https://www.cogeo.org/
[marblecutter]: https://github.com/sethfitz/marblecutter-virtual
[deck-gl-geotiff]: https://github.com/developmentseed/deck.gl-raster/tree/main/packages/deck.gl-geotiff
[deck-gl-raster]: https://github.com/developmentseed/deck.gl-raster/tree/main/packages/deck.gl-raster

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
| `rescale`  | `0,3000`               | One global `min,max` range applied before the colormap.              |
| `colormap` | `viridis`              | Single-band only. 96 named colormaps from deck.gl-raster.            |
| `nodata`   | `-9999` \| `off`       | Override of the COG's declared nodata.                               |
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
3. **Rescale, colormap, nodata.** Optional modules layer on top:
   `LinearRescale` for value normalization, `Colormap` (single-band only)
   for color lookup against a 2D-array sprite of 96 named colormaps,
   `FilterNoDataVal` to discard nodata.

The first render after a URL load fetches once. Every subsequent control
change — mode toggle, band swap, rescale, colormap pick, nodata, opacity,
basemap, panel collapse — is GPU-only.

### Auto behavior

- **Mode.** If no `?mode=` is set and the COG has fewer than 2 bands, the
  app auto-fills `mode=single&bands=1` so single-band COGs render through
  a colormap rather than as raw grayscale.
- **Rescale.** If no `?rescale=` is set, the app reads per-band
  `STATISTICS_MINIMUM` / `STATISTICS_MAXIMUM` from `GDAL_METADATA`. If
  those are absent it samples the coarsest overview's first tile and
  computes per-band min/max. The result populates the Rescale form fields
  (labeled "auto") and is averaged into a single global range for
  `LinearRescale`.
- **Band names.** Per-band `<Item name="DESCRIPTION" sample="N">…</Item>`
  entries in `GDAL_METADATA` (and the `BAND_NAME` alias) become labels in
  the band picker — `1 — B04`, etc.
- **Fit bounds.** First tile-pyramid metadata load triggers a one-shot
  `fitBounds` to the COG's geographic extent.

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
│  │ GeoTIFF.fromUrl  │  (we construct it ourselves with a    │
│  │ chunkSize 1 MB   │   1 MB prefetch chunk; see workaround │
│  │                  │   in src/App.tsx)                     │
│  └────────┬─────────┘                                       │
│           ▼                                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ MapLibre <Map>                                       │   │
│  │  • basemap from resolveBasemap()                     │   │
│  │  • <DeckGLOverlay layers=[COGLayer]>                 │   │
│  │     custom getTileData → fetch tile, upload up to 4  │   │
│  │       r-channel textures                             │   │
│  │     custom renderTile → CompositeBands → LinearRescale │ │
│  │       → Colormap? → FilterNoDataVal                  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

Source layout:

| Path                                 | Role                                                       |
| ------------------------------------ | ---------------------------------------------------------- |
| `src/App.tsx`                        | Map shell, layer construction, GeoTIFF lifecycle.          |
| `src/state/useCogState.ts`           | URL search-params hook (parse / serialize / subscribe).    |
| `src/render/tile-loader.ts`          | `makeMultiBandTileLoader`: per-band r-channel textures.    |
| `src/render/render-pipeline.ts`      | RGB and single-band `renderTile` builders.                 |
| `src/render/stats.ts`                | `readBandCount`, `readBandNames`, `computeAutoStats`.      |
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
- **`LinearRescale` is global.** Per-band rescale isn't supported by the
  shipped GPU module; we pass one min/max applied uniformly across RGB.
- **No gamma / sigmoidal / hillshade / band-math expressions.** Each
  needs a custom luma.gl shader module; deferred.
- **GeoTIFF range bug.** A bug in `@developmentseed/geotiff` 0.6.1's
  `SourceHttp.fetch` produces malformed `Range: bytes=START-END` headers
  (with `END < START`) when the IFD chain points past the prefetch
  window, which causes S3 to return the entire file. We work around it
  by constructing the `GeoTIFF` ourselves with a 1 MB prefetch chunk;
  see the comment in `src/App.tsx`. Remove once the upstream fix lands
  (post-0.6.1).

## Design + plan documents

- [`docs/plans/2026-05-05-cog-viewer-design.md`](./docs/plans/2026-05-05-cog-viewer-design.md)
- [`docs/plans/2026-05-05-cog-viewer.md`](./docs/plans/2026-05-05-cog-viewer.md)
