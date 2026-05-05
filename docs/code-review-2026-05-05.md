# Code Review — 2026-05-05

Synthesis of five parallel agent reviews (bugs, performance, state/URL,
cleanliness, types/error-handling). Findings are deduplicated and
prioritized. File:line references are approximate; many will drift after
the first batch of fixes.

## Critical — user-visible breakage

### 1. `useMemo` deps churn `getTileData` → cache invalidates on every state change

**File:** `src/App.tsx:144-197`. The layer's `useMemo` re-runs on `state.opacity`, `state.mode`, `state.bands`, `state.rescale`, `state.nodata`, `state.colormap`, `colormapTexture`, allocating a fresh `makeMultiBandTileLoader([1,2,3,4])` every time. deck.gl's `TileLayer` treats a changed `getTileData` reference as cache-invalidating — so even though the layer id is stable, **opacity drag, band swap, colormap pick, and mode toggle all refetch tiles**. This contradicts the README's "GPU-only" guarantee.

**Fix:** hoist `const fetchedBands = [1, 2, 3, 4]` to module scope; memoize `getTileData = useMemo(() => makeMultiBandTileLoader(fetchedBands), [])`. Only `renderTile` (and the `geotiff` instance) should change between layer rebuilds.

### 2. Out-of-range / NaN bands crash the renderer

**Files:** `src/render/render-pipeline.ts:42-71, 76-113`, `src/state/useCogState.ts:22-23`. `buildCompositeBandsProps` throws if any selected band name isn't in `data.bands`, and also if the bands map is empty. URL state lets `?bands=foo,bar` parse to `[NaN, NaN]`, `?bands=` to `[NaN]`, and the dropdown lets out-of-range values persist. With a custom URL like `?bands=5,6,7` on a 4-band COG, the layer throws on first render.

**Fix:** in the parsers, filter to `Number.isFinite` and return `null` when the result is empty. In the renderTile builders, validate every selected index against `data.bands` and short-circuit to an empty pipeline (or fall back to the first available band) when invalid.

### 3. Tile textures never destroyed → GPU memory leak

**File:** `src/render/tile-loader.ts:117-123`. Each tile creates up to 4 `device.createTexture(...)`. Nothing calls `texture.destroy()` when the tile is evicted from deck.gl's cache. Estimate: a 4-band Float32 256² tile holds ~4 MB CPU + 16 MB GPU; a normal pan/zoom session leaks tens of MB. StrictMode double-creation in dev compounds it.

**Fix:** wire an `onTileUnload` (or whatever lifecycle hook the upstream layer exposes) that walks `data.bands` and calls `texture.destroy()` on each. Same treatment for the colormap texture in `App.tsx:129-142` on device replacement.

### 4. NaN-poisoned URL state

**File:** `src/state/useCogState.ts:14-42`. `parseRescale("abc")` → `[[NaN, NaN]]` (cast launders the type), `parseBands("")` → `[NaN]`, `parseNodata("")` → `0` (silently coerces empty), `opacity` parsing accepts `NaN`/`99`/`-1`. NaNs flow into `LinearRescale` uniforms, the band dropdown, and round-trip back into the URL on the next `serialize`.

**Fix:** finite-check every numeric parse; clamp opacity to `[0, 1]`; treat empty `nodata=` as `null`; tighten parsers and remove `as` casts. Add round-trip tests for malformed CSVs and `nodata=0`.

### 5. No error UI

**Files:** `src/App.tsx:97, 114, 133-137`. `GeoTIFF.fromUrl` rejection only `console.error`s; `computeAutoStats` only `console.warn`s; colormap fetch failure is silent; there's no error boundary around the layer. The design doc promised CORS / invalid-COG toasts. Currently the user sees a stuck loading state with no recovery.

**Fix:** add an `error: string | null` to App state; render a toast over the map or in the empty state with a `humanizeError` mapper (CORS / not-a-COG / network); wrap the map body in a React error boundary; pipe COGLayer's tile errors in.

## High

### 6. URL change doesn't clear image-specific params

**Files:** `src/components/EmptyState.tsx`, `src/App.tsx:81-103`. Pasting a new URL via the empty state only patches `url`; if the previous COG had `mode=rgb&bands=4,3,2&rescale=...`, those linger and apply to the new image. The auto-mode effect only runs when `state.mode === null`.

**Fix:** when `state.url` changes (in EmptyState submit and in the URL-change effect), reset `mode`, `bands`, `rescale`, `colormap`, `nodata`.

### 7. Drag-drop `blob:` URLs are unrecoverable on reload

**File:** `src/components/EmptyState.tsx:89, 100`. `URL.createObjectURL(file)` is written to the URL bar. On reload the blob is gone but `state.url` is set, so `EmptyState` doesn't show — the user gets a blank map with a dead `blob:…` URL.

**Fix:** detect `blob:` on initial load and clear `state.url`, OR keep the dropped File in component state instead of writing to the URL.

### 8. Auto-mode effect race + `bandCount === 2` falls through

**File:** `src/App.tsx:123-127`. The effect can fire after a deliberate user mode pick if `bandCount` resolves later than the click. `bandCount === 2` is neither single (default) nor RGB-friendly (only 2 bands). Across-URL navigation in the same tab keeps the prior `mode`/`bands` because the effect's `state.mode === null` guard fails.

**Fix:** use a `firstResolvedRef` so the auto-pick only fires once per URL; clear mode/bands on URL change (covered by #6); decide policy for 2-band COGs (probably `single`).

### 9. `byteLength` undercounts → cache eviction broken

**File:** `src/render/tile-loader.ts:124-130`. The reported `byteLength` uses `bytesPerPixelSingle(format)` for the originally-typed array — but `coerceForFormat` upcasts Int16/Uint16 sources to `Float32Array` (line 56-69), so the in-flight CPU buffer is 2× what's reported. GPU footprint isn't counted at all. deck.gl's `TileLayer` uses `byteLength` for cache budgeting; under-reporting means the cache holds far more tiles than its limit implies.

**Fix:** report the *post-coercion* CPU byte size, plus a GPU-residency multiplier.

### 10. Mode toggle in panel clobbers band selection

**File:** `src/components/ControlsPanel.tsx:148-162`. Switching `single → rgb` always writes `bands: [1, 2, 3]`, discarding any prior RGB triple. Switching to RGB on a 2-band COG writes invalid `[1, 2, 3]`.

**Fix:** memoize the last RGB triple per session; clamp to `bandOptions`.

### 11. Stats scan blocks the main thread

**File:** `src/render/stats.ts:70-107`. The fallback path scans every pixel of every band on the JS thread. For a 13-band Sentinel-2 coarsest overview at e.g. 512² that's ~3.4M iterations — multi-hundred-ms jank.

**Fix:** subsample (every Nth pixel), chunk per-band with `await Promise.resolve()` between bands, or move into a Worker.

### 12. Default colormap not persisted in URL

**File:** `src/components/ControlsPanel.tsx:75-78, 273`; `src/render/render-pipeline.ts:80`. When mode flips to `single`, the panel displays viridis but doesn't write `colormap=viridis` to the URL. The auto-rescale isn't pinned either. Sharing the URL gives a different (re-computed) view on reload.

**Fix:** when entering single mode, write `colormap: state.colormap ?? "viridis"`; when displaying auto-rescale to the user, don't write it (it's a runtime-derived default), but be honest in the UI that the rescale label says "auto".

### 13. `replaceState`-only → no browser back/forward

**File:** `src/state/useCogState.ts:91`. Every update replaces the history entry. The popstate subscription never fires for in-app changes. Users can't undo a panel action.

**Fix:** `pushState` for high-stakes changes (url, mode), `replaceState` for high-frequency ones (opacity drag, panel toggle); debounce sliders.

## Medium — cleanliness, types, dead code

- **`colorspace` field is dead.** Threaded through `CogState`, parsed/serialized, never read. Remove from types, parsers, and tests.
- **Duplicate maplibre CSS import.** Both `App.tsx:11` and `main.tsx:3` import it. Drop the App.tsx one.
- **Repeated defaults.** `[1, 2, 3]` (3 places), `"viridis"` (2 places), basemap list (3 places: `useCogState.ts`, `ControlsPanel.tsx`, `basemaps.ts`/types). Extract to a `defaults.ts` or co-locate with `resolveBasemap`.
- **Module mis-named.** `src/render/stats.ts` exports `readBandCount` and `readBandNames` — not stats. Rename to `cog-metadata.ts` or split.
- **`src/basemaps.ts` placement.** Sits at root while siblings live under `state/`, `render/`, `components/`. Move to `src/render/basemaps.ts` or `src/map/`.
- **350-line `ControlsPanel.tsx`.** Split into `BandSection`, `RescaleSection`, `NodataSection`, `OpacitySection`. Move `statsForBands` next to `AutoStats` in the metadata module.
- **Pipeline rebuild allocations in the hot path.** `renderTile` allocates a fresh `pipeline` array, `mapping` object, and rebuilds the rescale/nodata tail per visible tile per render. Precompute the constant module list when `state` changes; per-tile only build `compositeProps`.
- **Duplicated rescale+nodata tail in `render-pipeline.ts`.** Lift into a shared helper.
- **Inline styles vs design tokens.** Several layout grids use inline `style={{...}}` repeatedly. Add `.field-row-2`, `.field-row-3`, `.panel--floating` classes to `styles.css`.
- **Smoke test placeholder.** Delete `src/__tests__/smoke.test.ts` now that real tests exist.
- **Test gaps.** No tests for `parseBands`/`parseRescale` malformed input, `serializeCogState({nodata: "off"})`, `nodata: 0` round-trip, popstate-driven re-renders, `resolveBasemap`, `statsForBands`, render-pipeline builders, invalid-enum fallbacks for `basemap`/`panel`. `EmptyState.test.tsx` should import the URL from `EXAMPLES[0]` instead of hardcoding it.
- **Type laundering.** `as Mode` / `as Basemap` / `as PanelState` after `Array.includes` doesn't narrow. Replace with `is Mode` type guards. Same for `(COLORMAP_INDEX as Record<string, number>)` — narrow `state.colormap` to a union of `keyof typeof COLORMAP_INDEX` at parse time.
- **`singleBandFormat` fallthrough.** Returns `r8unorm` for any unknown dtype (Int8, Int32, Uint32, Float64). A 32-bit integer band uploaded as 8-bit unorm produces wrong pixels silently. Switch to an exhaustive switch on the typed-array constructor; throw / return null + surface to the error UI.
- **`extractBand` allocates per band per tile.** For pixel-interleaved tiles, walk all bands in a single pass and write into pre-typed band arrays.
- **Coerce-to-Float32 alloc on every Int16/Uint16 tile.** Either use integer texture formats (`r16uint`) and convert in shader, or stream-convert during a single read pass.
- **`CogStateUpdate` simplification.** `Partial<Omit<CogState, "opacity">> & { opacity?: number }` is identical to `Partial<CogState>`. Simplify. Also drop `undefined` keys before spread in `update()` to prevent silent overwrites.
- **`debug/range-trap.ts` TODO.** Add a `// TODO: remove with @developmentseed/geotiff > 0.6.1` so the next maintainer can grep alongside the App.tsx workaround.
- **`document.getElementById("root")!`.** Replace with a typed helper that throws a clear error if the root is missing.
- **Eager colormap sprite fetch.** `colormaps.png` is fetched on every session even when single-band mode is never used. Gate behind `state.mode === "single"`.
- **`EmptyState` could be `lazy()`.** It's hidden after first interaction.
- **Enable `noUncheckedIndexedAccess`** in `tsconfig.app.json`. Catches several of the band-index footguns automatically.

## Low

- `darkMql` snapshot is `false` server-side; hydration causes one extra render. Acceptable for a CSR-only Vite app.
- `DOMParser` parser-error nodes aren't checked in `readBandNames` — silent on malformed XML. Consider a console warning.
- `URL.createObjectURL` is never `revokeObjectURL`'d in EmptyState.
- NaN nodata not handled in `fromCoarsestOverview`: `v === arr.nodata` is always false when nodata is NaN.
- `useControl` + `setProps` mutates synchronously during render — violates React 19 rules-of-purity. Move into `useEffect`.

---

## Suggested order

1. **#1, #3** — they undermine the entire "GPU-only re-render" design and leak GPU memory.
2. **#2, #4** — input validation. One coordinated parser pass + render-pipeline guard fixes a class of crashes.
3. **#5** — error UI. Even a one-line toast unblocks all the silent-failure paths above.
4. **#6, #7, #8** — URL state hygiene around URL changes.
5. **#9, #11** — performance (cache budget + main-thread jank).
6. **#10, #12, #13** — UX polish around mode/colormap/back-forward.
7. The **medium** cleanup pass — best done as one big rename/split commit.
