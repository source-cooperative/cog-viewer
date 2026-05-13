import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import { RasterLayer } from "@developmentseed/deck.gl-raster";
import {
  createColormapTexture,
  decodeColormapSprite,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import type { GeoTIFF } from "@developmentseed/geotiff";
import type { Device, Texture } from "@luma.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import { isDarkChrome, resolveBasemap } from "./basemaps";
import { loadGeoTIFF } from "./cog/load-geotiff";
import { ControlsPanel } from "./components/ControlsPanel";
import { EmptyState } from "./components/EmptyState";
import { FullscreenButton } from "./components/FullscreenButton";
import { NonTiledBanner } from "./components/NonTiledBanner";
import { Toast, humanizeError } from "./components/Toast";
import { loadNonTiled, type NonTiledRaster } from "./render/load-non-tiled";
import { buildReprojectors, type ReprojectionFns } from "./render/reprojectors";
import {
  computeNonTiledSizes,
  extractGeoTiffSizeInputs,
} from "./render/non-tiled-sizes";
import {
  type NonTiledStatus,
  shouldRender,
  statusFromSizes,
} from "./render/non-tiled-status";
import {
  buildRgbCompositeRenderTile,
  buildSingleCompositeRenderTile,
} from "./render/render-pipeline";
import {
  computeAutoStats,
  readBandNames,
  type AutoStats,
} from "./render/stats";
import {
  makeMultiBandTileLoader,
  MAX_BAND_SLOTS,
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
  const [nonTiledStatus, setNonTiledStatus] = useState<NonTiledStatus>(null);
  const [nonTiledRaster, setNonTiledRaster] = useState<NonTiledRaster | null>(null);
  const [reprojectionFns, setReprojectionFns] = useState<ReprojectionFns | null>(null);
  // First symbol (label) layer id in the active basemap style. Used as
  // beforeId so the COG draws under labels when state.labelsAbove is true.
  // Undefined when the basemap has no labels (satellite / off).
  const [firstSymbolId, setFirstSymbolId] = useState<string | undefined>();
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
    setNonTiledStatus(null);
    setNonTiledRaster(null);
    setReprojectionFns(null);
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

  // When we have a GeoTIFF for the current URL, compute auto-stats once.
  useEffect(() => {
    if (!geotiff) return;
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

  // When a non-tiled GeoTIFF arrives, validate CRS + compute sizes + seed
  // status. Doing the CRS check here (rather than inside the loader
  // effect) lets us fail fast on non-4326 before decoding all strips.
  // Also publishes bandCount + bandNames so the ControlsPanel + auto-mode
  // effect can light up before the (potentially slow) strip decode runs.
  useEffect(() => {
    if (!geotiff) return;
    if (geotiff.isTiled) return;
    try {
      setReprojectionFns(buildReprojectors(geotiff));
    } catch (err) {
      console.error("buildReprojectors failed", err);
      setError(humanizeError(err));
      return;
    }
    const inputs = extractGeoTiffSizeInputs(geotiff);
    if (!inputs) {
      setError("Stripped GeoTIFF is missing StripByteCounts and cannot be sized.");
      return;
    }
    const sizes = computeNonTiledSizes(inputs);
    setNonTiledStatus(statusFromSizes(sizes));
    setBandCount(geotiff.count);
    setBandNames(readBandNames(geotiff));
  }, [geotiff]);

  // Run loadNonTiled when (a) we have a non-tiled geotiff, (b) the status
  // indicates we should render, (c) the device is ready, (d) bands are
  // known. Re-runs on band changes so we only upload what's needed.
  useEffect(() => {
    if (!geotiff || !device) return;
    if (!shouldRender(nonTiledStatus)) return;
    const bands = state.bands ?? (geotiff.count >= 3 ? [1, 2, 3] : [1]);
    const ctrl = new AbortController();
    (async () => {
      try {
        // TODO: this re-decodes every strip on band changes, which can take
        // seconds for compressed multi-strip TIFFs. Caching decoded bands
        // by [geotiff] and only re-uploading textures on band swap would
        // keep band-toggle interactive.
        const raster = await loadNonTiled(geotiff, bands, device, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setNonTiledRaster(raster);
        // Trigger fitBounds for the non-tiled path (COGLayer's onGeoTIFFLoad
        // does this for tiled). Use the existing geotiff.bbox + transform.
        const bbox = geotiff.bbox;
        mapRef.current?.fitBounds(
          [
            [bbox[0], bbox[1]],
            [bbox[2], bbox[3]],
          ],
          { padding: 40, duration: 800 },
        );
      } catch (err) {
        if (!ctrl.signal.aborted) {
          console.error("loadNonTiled failed", err);
          setError(humanizeError(err));
        }
      }
    })();
    return () => ctrl.abort();
  }, [geotiff, device, nonTiledStatus?.kind, state.bands]);

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
    if (!geotiff) return null;

    // Build the renderTile callback once. Whether we wrap a tiled
    // COGLayer (per-tile callback) or feed a single RasterLayer (one-shot
    // pipeline), the inputs and outputs are identical. Single-band mode
    // additionally needs the colormap sprite uploaded to the device, so we
    // fall back to RGB rendering until that's ready.
    const buildRenderPipeline =
      state.mode === "single" && colormapTexture
        ? buildSingleCompositeRenderTile(state, colormapTexture, autoStats)
        : buildRgbCompositeRenderTile(state, autoStats);

    if (geotiff.isTiled) {
      // Existing tiled path (unchanged). beforeId places the COG below the
      // first symbol (label) layer so labels remain readable. Read by
      // @deck.gl/mapbox's MapboxOverlay in interleaved mode but missing from
      // COGLayer's narrower props type — extract to a const so structural
      // assignability applies instead of the excess-property check.
      const cogProps = {
        id: "cog",
        geotiff,
        opacity: state.opacity,
        getTileData,
        renderTile: buildRenderPipeline,
        beforeId: state.labelsAbove ? firstSymbolId : undefined,
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
    }

    // Non-tiled path: single RasterLayer, no tile cache.
    if (!nonTiledRaster || !reprojectionFns) return null;
    const result = buildRenderPipeline(nonTiledRaster.data);
    const pipeline = "renderPipeline" in result ? result.renderPipeline : undefined;
    if (!pipeline || pipeline.length === 0) return null;

    // beforeId is read by @deck.gl/mapbox's MapboxOverlay in interleaved
    // mode but missing from RasterLayer's narrower props type. Extract to
    // a const so structural assignability applies instead of the
    // excess-property check.
    const rasterProps = {
      id: "cog",
      width: nonTiledRaster.width,
      height: nonTiledRaster.height,
      reprojectionFns,
      renderPipeline: pipeline,
      opacity: state.opacity,
      beforeId: state.labelsAbove ? firstSymbolId : undefined,
    };
    return new RasterLayer(rasterProps);
  }, [
    geotiff,
    state.opacity,
    state.mode,
    state.bands,
    state.rescale,
    state.nodata,
    state.colormap,
    state.gamma,
    state.stretch,
    state.labelsAbove,
    firstSymbolId,
    colormapTexture,
    bandNames,
    autoStats,
    nonTiledRaster,
    reprojectionFns,
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

      <NonTiledBanner
        status={nonTiledStatus}
        onConfirm={() =>
          setNonTiledStatus((s) => (s ? { ...s, kind: "confirmed" } : s))
        }
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
