# COG Viewer — Design

**Date:** 2026-05-05
**Status:** Approved

## Summary

A static, client-side web app that renders Cloud Optimized GeoTIFFs in the browser using `@developmentseed/deck.gl-geotiff` and `@developmentseed/deck.gl-raster`. Inspired by [marblecutter-virtual](https://github.com/sethfitz/marblecutter-virtual) but with no server: the COG is fetched and decoded entirely in the browser.

The COG URL is supplied via `?url=` query parameter. When absent, the app shows an empty-state panel offering URL paste, drag-and-drop, and a curated examples dropdown. Rendering controls (mode, band selection, rescale, colormap, etc.) are also URL-synced, so any visualization is shareable as a permalink.

## Scope (v1 — "trimmed marblecutter parity")

In scope, since the deck.gl-raster GPU modules support them natively:

- RGB / band-composite rendering (`CompositeBands`)
- Single-band rendering with named colormaps (`Colormap`)
- Linear rescale per band (`LinearRescale`)
- Nodata masking (`FilterNoDataVal`, auto from COG tags, user-overridable)
- Color-space conversion when a COG declares it (`WhiteIsZero`, `BlackIsZero`, `YCbCr`, `CMYK`, `CIELab`)

Explicitly out of scope for v1 (require custom luma.gl shader work; deferred):

- Gamma correction
- Sigmoidal contrast
- Hillshade
- Band-math expressions (NDVI, etc.)

## Stack

- Vite + React + TypeScript
- `@deck.gl/core`, `@deck.gl/mapbox`
- `@developmentseed/deck.gl-geotiff` — provides `COGLayer` (handles fetch, decode, tile pyramid)
- `@developmentseed/deck.gl-raster` — provides GPU rendering modules
- `react-map-gl/maplibre` + `maplibre-gl` — basemap (Carto dark-matter, no token)
- Vitest + React Testing Library — tests

No backend. Hostable as static files.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  React app (Vite)                                           │
│                                                             │
│  ┌──────────────────┐    ┌────────────────────────────┐     │
│  │ URL state hook   │◄───┤ Controls panel (side)      │     │
│  │ (?url, ?mode,…)  │    │ - Mode toggle              │     │
│  └────────┬─────────┘    │ - Band picker              │     │
│           │              │ - Rescale per band         │     │
│           ▼              │ - Colormap                 │     │
│  ┌──────────────────┐    │ - Nodata, opacity          │     │
│  │ COG metadata     │    └────────────────────────────┘     │
│  │ (onGeoTIFFLoad)  │                                       │
│  └────────┬─────────┘                                       │
│           ▼                                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ MapLibre <Map>                                       │   │
│  │  • Carto dark-matter style                           │   │
│  │  • <DeckGLOverlay layers=[COGLayer]>                 │   │
│  │     COGLayer: { geotiff: url, renderPipeline: […] }  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

The URL is the single source of truth. Every control writes through `useSearchParams`; the deck.gl layer rebuilds its `renderPipeline` from those params via `useMemo`.

## Components

| Component | Responsibility |
|---|---|
| `App` | Owns the map and the layer; reads URL state; handles empty state. |
| `useCogState()` | Typed wrapper around `useSearchParams`. Exposes `{url, mode, bands, rescale, colormap, nodata, opacity, colorspace}` plus setters that write back to the URL. |
| `useCogMetadata()` | Captures `onGeoTIFFLoad` output; exposes `{bandCount, dtype, nodata, bounds, photometric}` for default-fill and UI labels. |
| `CogLayerWrapper` | Builds a `COGLayer` from URL state; memoizes `renderPipeline`. |
| `ControlsPanel` | Right-side panel (mobile: bottom drawer). Sections: Source / Mode / Bands / Rescale / Colormap / Display. |
| `EmptyState` | Centered card with URL input, drop zone, examples list. Shown when no `?url=`. |
| `examples.json` | Static list of CORS-enabled public COGs (sourced from upstream's `cog-basic` example). |

## Rendering pipeline

`renderPipeline` is constructed deterministically from URL state. Order matters.

**RGB mode (≥3 bands):**
```
CompositeBands(bands) → LinearRescale(perBandRange) → colorspace? → FilterNoDataVal(nodata)
```

**Single-band mode:**
```
LinearRescale(min,max) → Colormap(name) → FilterNoDataVal(nodata)
```

Color-space conversion is auto-applied based on the COG's `PhotometricInterpretation` tag and may be overridden by `?colorspace=`.

## URL parameters

| Param | Type | Default | Notes |
|---|---|---|---|
| `url` | string | — | Required. HTTPS URL to a CORS-enabled COG. |
| `mode` | `rgb` \| `single` | auto | `rgb` if ≥3 bands, else `single`. |
| `bands` | csv ints | auto | RGB mode only, e.g. `4,3,2`. |
| `rescale` | csv floats | auto | `min,max` (single) or `min,max;min,max;min,max` (RGB). |
| `colormap` | string | `viridis` (float) / `gray` (int) | Single-band only. |
| `nodata` | float \| `auto` \| `off` | `auto` | Override of detected nodata. |
| `opacity` | float `0..1` | `1` | Layer opacity. |
| `colorspace` | string | auto | Override photometric interpretation. |

Default values are written to the URL only on first metadata load when absent — never overwritten if the user set them.

## Data flow

1. Page loads. `useCogState` parses URL.
2. If `url` missing → render `EmptyState`. User submits URL via paste/drop/example → URL updates → re-renders.
3. `CogLayerWrapper` mounts a `COGLayer` with `geotiff: url`.
4. `onGeoTIFFLoad` fires. `useCogMetadata` populates state. Defaults are filled into URL where absent.
5. Map `fitBounds` to `geographicBounds` (one-shot, only on first metadata load).
6. Any control change → URL update → `renderPipeline` rebuilt via `useMemo` → deck.gl re-renders.

## Error handling

| Condition | Behavior |
|---|---|
| CORS failure | Toast: "This COG isn't CORS-enabled. The host needs `Access-Control-Allow-Origin`." Keep empty-state visible. |
| Not a valid COG | Toast: "This file isn't a valid Cloud Optimized GeoTIFF." |
| Mode/band-count mismatch (e.g. `mode=rgb` on 1-band COG) | Silently fall back to `single`; console warning. |
| Rescale `min == max` | Clamp to `[min, min + ε]` to avoid NaN. |
| Drag-and-drop file | `URL.createObjectURL(file)` → pass blob URL to COGLayer. Examples list still uses HTTPS URLs. |

## Testing strategy

Unit (Vitest):
- `useCogState`: URL ↔ state round-trip; default-fill never overwrites set values.
- Pipeline builder: given state X, returns modules `[A, B, C]` in expected order (snapshot).

Component (React Testing Library):
- `EmptyState`: paste-URL flow updates URL.
- `ControlsPanel`: changing a control writes the URL.

Out of scope for v1:
- Live-COG integration tests (slow, flaky). Smoke-test layer mount with a mocked `COGLayer`.

## Open follow-ons (post-v1)

- Custom luma.gl shader modules: gamma, sigmoidal, hillshade, band-math expressions.
- Multi-COG mosaicking via `MultiCOGLayer`.
- Histogram + percentile auto-stretch UI.
- Pixel inspector / value-at-cursor readout.
- **Antimeridian wrap.** `@developmentseed/deck.gl-raster`'s `RasterReprojector` produces a single mesh in source-CRS coordinates without world-copy duplication, so a COG centered near 180° appears only once and is clipped where the map repeats. Fixing this requires upstream changes (or replicating layer instances in client-shifted longitude bands), out of scope for v1.
