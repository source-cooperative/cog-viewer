import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import {
  createColormapTexture,
  decodeColormapSprite,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import { RasterLayer } from "@developmentseed/deck.gl-raster";
import type { GeoTIFF } from "@developmentseed/geotiff";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type { Device, Texture } from "@luma.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import { isDarkChrome, resolveBasemap } from "./basemaps";
import { loadGeoTIFF } from "./cog/load-geotiff";
import {
  readWholeImage,
  tooLargeReason,
  type WholeImage,
} from "./cog/read-strips";
import {
  buildReprojectionFns,
  geographicBounds,
  resolveSourceProjection,
} from "./cog/reproject";
import { ControlsPanel } from "./components/ControlsPanel";
import { EmptyState } from "./components/EmptyState";
import { FullscreenButton } from "./components/FullscreenButton";
import { Toast, humanizeError } from "./components/Toast";
import {
  buildRgbCompositeRenderTile,
  buildSingleCompositeRenderTile,
} from "./render/render-pipeline";
import {
  computeAutoStats,
  computeAutoStatsFromArrays,
  readBandNames,
  type AutoStats,
} from "./render/stats";
import {
  buildWholeImageTileData,
  makeMultiBandTileLoader,
  MAX_BAND_SLOTS,
  type MultiBandTileData,
} from "./render/tile-loader";
import { useCogState } from "./state/useCogState";

const darkMql = window.matchMedia("(prefers-color-scheme: dark)");
const subscribeColorScheme = (cb: () => void) => {
  darkMql.addEventListener("change", cb);
  return () => darkMql.removeEventListener("change", cb);
};
const getColorSchemeSnapshot = () => darkMql.matches;
const usePrefersDark = () =>
  useSyncExternalStore(subscribeColorScheme, getColorSchemeSnapshot, () => false);

function DeckGLOverlay(
  props: MapboxOverlayProps & { onDeviceInitialized?: (d: Device) => void },
) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

// Module-scope so getTileData identity stays stable across renders. deck.gl's
// TileLayer treats a changed getTileData reference as cache-invalidating, so
// allocating a fresh closure per render would defeat the stable-id design and
// refetch tiles on every state change (opacity drag, band swap, etc.).
const FETCHED_BANDS = Array.from({ length: MAX_BAND_SLOTS }, (_, i) => i + 1);
const getTileData = makeMultiBandTileLoader(FETCHED_BANDS);

/** Image-specific URL params that don't make sense across COGs. Cleared
 * whenever state.url changes (e.g., user pastes a new COG). */
const IMAGE_SPECIFIC_RESET = {
  mode: null,
  bands: null,
  rescale: null,
  colormap: null,
  nodata: null,
} as const;

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [state, update] = useCogState();
  const prefersDark = usePrefersDark();
  const [device, setDevice] = useState<Device | null>(null);
  const [colormapTexture, setColormapTexture] = useState<Texture | null>(null);
  const [geotiff, setGeotiff] = useState<GeoTIFF | null>(null);
  const [autoStats, setAutoStats] = useState<AutoStats | null>(null);
  const [bandCount, setBandCount] = useState<number | null>(null);
  const [bandNames, setBandNames] = useState<Map<number, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Non-tiled (stripped) TIFF whole-file render path. `@developmentseed/geotiff`
  // can't read stripped images tile-by-tile, so these hold the whole-image
  // bands (read via geotiff.js), the pixel↔WGS84 reprojection functions, the
  // uploaded per-band GPU textures, and an info notice. All null for tiled COGs.
  const [wholeImage, setWholeImage] = useState<WholeImage | null>(null);
  const [reprojectionFns, setReprojectionFns] = useState<ReprojectionFns | null>(
    null,
  );
  const [wholeImageData, setWholeImageData] = useState<MultiBandTileData | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  // First symbol (label) layer id in the active basemap style. Used as
  // beforeId so the COG draws under labels when state.labelsAbove is true.
  // Undefined when the basemap has no labels (satellite / off).
  const [firstSymbolId, setFirstSymbolId] = useState<string | undefined>();
  // Drop the cached id whenever the basemap switches. It was read from the
  // OLD style and the new style may not contain that layer — leaving it in
  // place causes deck.gl's MapboxOverlay to throw "Cannot move layer ...
  // before non-existing layer X" on the next styledata event.
  useEffect(() => {
    setFirstSymbolId(undefined);
  }, [state.basemap]);
  // Tracks which URL the auto-mode effect has already fired for. Prevents a
  // late-arriving bandCount from clobbering an explicit user mode pick made
  // between the URL change and metadata load.
  const autoModeFiredFor = useRef<string | null>(null);

  // Drop blob: URLs from prior drag-drop sessions on initial mount — they
  // can't survive a reload, so the map would otherwise show a stuck broken
  // state with no recovery (EmptyState only renders when !state.url).
  useEffect(() => {
    if (state.url?.startsWith("blob:")) {
      update({ url: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open the GeoTIFF ourselves through the CORS workaround in cog/load-geotiff.
  // Required (not just an optimization) because the geotiff library's
  // SourceHttp misreads Content-Length of a 206 response as the whole-file
  // size when the bucket doesn't expose Content-Range via CORS — leading to
  // malformed Range headers and a full-file download. See load-geotiff.ts.
  useEffect(() => {
    setGeotiff(null);
    setAutoStats(null);
    setBandCount(null);
    setBandNames(null);
    setError(null);
    setWholeImage(null);
    setReprojectionFns(null);
    setWholeImageData(null);
    setNotice(null);
    const url = state.url;
    if (!url) return;
    let cancelled = false;
    (async () => {
      try {
        const tiff = await loadGeoTIFF(url);
        if (!cancelled) setGeotiff(tiff);
      } catch (err) {
        if (!cancelled) {
          console.error("loadGeoTIFF failed", err);
          setError(humanizeError(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.url]);

  // When we have a TILED GeoTIFF for the current URL, compute auto-stats once
  // by sampling tiles. Stripped images can't be sampled via fetchTile; their
  // stats are computed from the whole-image arrays in the non-tiled effect below.
  useEffect(() => {
    if (!geotiff || !geotiff.isTiled) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const stats = await computeAutoStats(geotiff, ctrl.signal, (partial) => {
          if (!ctrl.signal.aborted) setAutoStats(partial);
        });
        if (!ctrl.signal.aborted) setAutoStats(stats);
      } catch (err) {
        if (!ctrl.signal.aborted) console.warn("auto-stats failed", err);
      }
    })();
    return () => ctrl.abort();
  }, [geotiff]);

  // Non-tiled (stripped) TIFF: read the whole file with geotiff.js, build the
  // reprojection functions, fit the map to its bounds, and compute stats from
  // the in-memory bands. Guarded by a size check against the already-loaded
  // metadata so a huge stripped file is never downloaded.
  // TODO(#573): retire once @developmentseed/geotiff can read stripped images.
  useEffect(() => {
    if (!geotiff || geotiff.isTiled) return;
    const url = state.url;
    if (!url) return;
    const ctrl = new AbortController();
    (async () => {
      const reason = tooLargeReason(geotiff.width, geotiff.height, geotiff.count);
      if (reason) {
        setError(`Stripped TIFF can't be rendered: ${reason}.`);
        return;
      }
      try {
        const [image, sourceProjection] = await Promise.all([
          readWholeImage(url, ctrl.signal),
          resolveSourceProjection(geotiff),
        ]);
        if (ctrl.signal.aborted) return;
        const fns = buildReprojectionFns(geotiff, sourceProjection);
        const bounds = geographicBounds(geotiff, fns);
        setWholeImage(image);
        setReprojectionFns(fns);
        setBandCount(geotiff.count);
        setBandNames(readBandNames(geotiff));
        setAutoStats(computeAutoStatsFromArrays(geotiff, image.bands));
        setNotice("Stripped (non-tiled) TIFF — rendered in whole-file mode.");
        mapRef.current?.fitBounds(
          [
            [bounds.west, bounds.south],
            [bounds.east, bounds.north],
          ],
          { padding: 40, duration: 800 },
        );
      } catch (err) {
        if (!ctrl.signal.aborted) {
          console.error("non-tiled load failed", err);
          setError(humanizeError(err));
        }
      }
    })();
    return () => ctrl.abort();
  }, [geotiff, state.url]);

  // Upload the whole-image bands as per-band GPU textures once the device and
  // image are both ready. Stable across render-state changes (mode, rescale,
  // colormap, …) so those re-render from cached textures without a re-read,
  // mirroring the fixed FETCHED_BANDS tile-cache design.
  useEffect(() => {
    if (!device || !wholeImage) {
      setWholeImageData(null);
      return;
    }
    setWholeImageData(
      buildWholeImageTileData(
        device,
        FETCHED_BANDS,
        wholeImage,
        geotiff?.nodata ?? null,
      ),
    );
  }, [device, wholeImage, geotiff]);

  // After bandCount resolves for a URL, fire a one-shot auto-pick of mode +
  // bands when the user hasn't set them. The ref-guard prevents a late
  // bandCount from overriding a deliberate user choice made between the URL
  // change and metadata load. Resets per URL.
  useEffect(() => {
    if (!state.url) return;
    if (bandCount === null) return;
    if (autoModeFiredFor.current === state.url) return;
    autoModeFiredFor.current = state.url;
    if (state.mode !== null) return;
    if (bandCount >= 3) {
      update({ mode: "rgb", bands: [1, 2, 3] });
    } else {
      // 1 or 2 bands → single + colormap. RGB on 2 bands leaves blue empty.
      update({ mode: "single", bands: [1] });
    }
  }, [bandCount, state.url, state.mode, update]);

  useEffect(() => {
    if (!device) return;
    let cancelled = false;
    (async () => {
      const resp = await fetch(colormapsPngUrl);
      const bytes = await resp.arrayBuffer();
      const image = await decodeColormapSprite(bytes);
      if (cancelled) return;
      setColormapTexture(createColormapTexture(device, image));
    })();
    return () => {
      cancelled = true;
    };
  }, [device]);

  const layer = useMemo(() => {
    // Wait until we've constructed the GeoTIFF with our own chunk size. The
    // URL-only fast path is intentionally gone — see the workaround comment
    // above on why we hand a pre-built GeoTIFF instance to COGLayer.
    if (!geotiff) return null;

    // The render pipeline is identical for tiled and non-tiled images — both
    // produce a `{ renderPipeline }` whose CompositeBands references per-band
    // textures. Single-band mode additionally needs the colormap sprite
    // uploaded to the device, so we fall back to RGB rendering until ready.
    const renderTile =
      state.mode === "single" && colormapTexture
        ? buildSingleCompositeRenderTile(state, colormapTexture, autoStats)
        : buildRgbCompositeRenderTile(state, autoStats);

    // beforeId places the raster below the first symbol (label) layer so labels
    // remain readable. Read by @deck.gl/mapbox's MapboxOverlay in interleaved
    // mode but missing from the layers' narrower props types — extract to a
    // const so structural assignability applies instead of the excess-property
    // check. Suppressed for basemaps known to have no labels so we don't carry
    // a stale id from the previous style into setStyle (see firstSymbolId
    // reset effect above).
    const labelsAvailable =
      state.basemap !== "satellite" && state.basemap !== "off";
    const beforeId =
      state.labelsAbove && labelsAvailable ? firstSymbolId : undefined;

    // Non-tiled (stripped) path: render the whole image as a single
    // reprojected RasterLayer, reusing the exact same render pipeline. Waits
    // for the uploaded textures and reprojection functions.
    if (!geotiff.isTiled) {
      if (!wholeImageData || !reprojectionFns) return null;
      const { renderPipeline } = renderTile(wholeImageData);
      const rasterProps = {
        id: "cog",
        width: wholeImageData.width,
        height: wholeImageData.height,
        reprojectionFns,
        renderPipeline,
        opacity: state.opacity,
        beforeId,
      };
      return new RasterLayer(rasterProps);
    }

    // Tiled COG path: stable id "cog" so the tile cache survives every
    // mode/band/rescale/colormap toggle.
    const cogProps = {
      id: "cog",
      geotiff,
      opacity: state.opacity,
      getTileData,
      renderTile,
      beforeId,
      onGeoTIFFLoad: (
        tiff: GeoTIFF,
        options: {
          geographicBounds: { west: number; south: number; east: number; north: number };
        },
      ) => {
        setBandCount(tiff.count);
        setBandNames(readBandNames(tiff));
        const { west, south, east, north } = options.geographicBounds;
        mapRef.current?.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          { padding: 40, duration: 800 },
        );
      },
    };
    return new COGLayer(cogProps);
  }, [
    geotiff,
    wholeImageData,
    reprojectionFns,
    state.opacity,
    state.mode,
    state.bands,
    state.rescale,
    state.nodata,
    state.colormap,
    state.gamma,
    state.labelsAbove,
    state.basemap,
    firstSymbolId,
    colormapTexture,
    bandNames,
    autoStats,
  ]);

  // Apply the dark theme to <html> so portal-rendered children
  // (Tooltip, etc.) get the same CSS variables as the panel.
  const darkChrome = isDarkChrome(state.basemap, prefersDark);
  useEffect(() => {
    document.documentElement.classList.toggle("theme-dark", darkChrome);
  }, [darkChrome]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{ longitude: 0, latitude: 0, zoom: 2 }}
        mapStyle={resolveBasemap(state.basemap, prefersDark)}
        onStyleData={(e) => {
          // styledata fires often (e.g., on tile arrival). Dedupe at the
          // setState level so we only re-render when the symbol id actually
          // changes (basemap swap or initial load).
          const layers = e.target.getStyle()?.layers ?? [];
          const next = layers.find((l) => l.type === "symbol")?.id;
          setFirstSymbolId((prev) => (prev === next ? prev : next));
        }}
      >
        <DeckGLOverlay
          layers={layer ? [layer] : []}
          interleaved
          onDeviceInitialized={setDevice}
        />
      </MaplibreMap>

      <ControlsPanel
        state={state}
        update={update}
        bandCount={bandCount}
        bandNames={bandNames}
        autoStats={autoStats}
        geotiff={geotiff}
      />

      <Toast message={error} onDismiss={() => setError(null)} />
      <Toast
        message={notice}
        variant="info"
        onDismiss={() => setNotice(null)}
      />

      <FullscreenButton />

      {!state.url && (
        <EmptyState
          onSubmit={(url) => update({ url, ...IMAGE_SPECIFIC_RESET })}
        />
      )}
    </div>
  );
}
