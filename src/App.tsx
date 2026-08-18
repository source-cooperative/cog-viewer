import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
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
import { validateCog } from "./cog/validate";
import { ControlsPanel } from "./components/ControlsPanel";
import { EmptyState } from "./components/EmptyState";
import { FullscreenButton } from "./components/FullscreenButton";
import { Toast, humanizeError } from "./components/Toast";
import { isValidGeographicBounds } from "./geo/bounds";
import { selectOverlayLayers } from "./geo/overlay-layers";
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
  setTileErrorHandler,
} from "./render/tile-loader";
import { useCogState } from "./state/useCogState";

// Get the default epsgResolver from COGLayer's defaultProps so the wrapper has
// a stable identity (module scope = no re-creation on every render).
// COGLayer.defaultProps is typed as typeof RasterTileLayer.defaultProps, which
// doesn't expose epsgResolver, so we access it via any.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _defaultEpsgResolver = (COGLayer as any).defaultProps.epsgResolver as (
  epsg: number,
) => Promise<Record<string, unknown>>;

/**
 * epsg.io PROJJSON for projected CRS (e.g. ESRI:54009 World Mollweide) often
 * omits 'unit' from Cartesian axes.  wkt-parser then leaves `units` undefined,
 * causing COGLayer._parseGeoTIFF to throw "Source projection is missing
 * 'units' property" as an unhandled rejection — silently killing the layer.
 * For any EPSG-registered Cartesian projected system, metres is the correct
 * default when no unit is stated.
 */
async function robustEpsgResolver(epsg: number) {
  const proj = await _defaultEpsgResolver(epsg);
  if ((!proj.units || proj.units === "unknown") && proj.projName !== "longlat") {
    (proj as Record<string, unknown>).units = "m";
  }
  return proj;
}

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
  // False when the COG's geographic extent couldn't be determined (unresolved
  // or unsupported CRS). Gates the tile layer off so we don't paint mislocated
  // tiles alongside the "could not determine geographic extent" error — the
  // tile-placement path clamps coordinates and would otherwise draw anyway.
  const [extentValid, setExtentValid] = useState(true);
  // Non-blocking notice (e.g. a COG with no overviews) — rendered as an amber
  // Toast alongside the red error one; the two are mutually exclusive per load.
  const [warning, setWarning] = useState<string | null>(null);
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
    setWarning(null);
    setExtentValid(true);
    const url = state.url;
    if (!url) return;
    let cancelled = false;
    (async () => {
      try {
        const tiff = await loadGeoTIFF(url);
        if (cancelled) return;
        // The file may open as a valid TIFF yet not be a renderable COG (e.g.
        // striped/non-tiled). Reject those up front with a clear message —
        // otherwise every fetchTile call throws and deck.gl swallows it,
        // leaving a blank map. See cog/validate.ts.
        const issue = validateCog(tiff);
        if (issue?.level === "error") {
          setError(issue.message);
          return;
        }
        if (issue?.level === "warning") setWarning(issue.message);
        setGeotiff(tiff);
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

  // Surface tile fetch/decode failures (which deck.gl otherwise swallows) as a
  // user-facing error. Registered once; the handler reads setError, which is
  // stable across renders. We don't clobber an already-shown error so a burst
  // of failing tiles yields one message, not a flicker.
  useEffect(() => {
    setTileErrorHandler((err) => {
      setError((prev) => prev ?? humanizeError(err, "tile"));
    });
    return () => setTileErrorHandler(null);
  }, []);

  // _parseGeoTIFF in deck.gl-geotiff has incomplete error handling — errors
  // after fetchGeoTIFF (CRS parsing, epsgResolver, units check) become
  // unhandled promise rejections. Catch them here and show as a toast.
  useEffect(() => {
    const handle = (e: PromiseRejectionEvent) => {
      console.error("[cog-viewer] Unhandled rejection:", e.reason);
      setError((prev) => prev ?? humanizeError(e.reason));
    };
    window.addEventListener("unhandledrejection", handle);
    return () => window.removeEventListener("unhandledrejection", handle);
  }, []);

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

    // Always mount the custom path (stable id "cog") so the tile cache
    // survives every mode/band/rescale/colormap toggle. Single-band mode
    // additionally needs the colormap sprite uploaded to the device, so we
    // fall back to RGB rendering until that's ready.
    const renderTile =
      state.mode === "single" && colormapTexture
        ? buildSingleCompositeRenderTile(state, colormapTexture, autoStats)
        : buildRgbCompositeRenderTile(state, autoStats);

    // beforeId places the COG below the first symbol (label) layer so labels
    // remain readable. Read by @deck.gl/mapbox's MapboxOverlay in interleaved
    // mode but missing from COGLayer's narrower props type — extract to a
    // const so structural assignability applies instead of the excess-property
    // check. Suppress for basemaps known to have no labels so we don't carry
    // a stale id from the previous style into setStyle (see firstSymbolId
    // reset effect above).
    const labelsAvailable =
      state.basemap !== "satellite" && state.basemap !== "off";
    const cogProps = {
      id: "cog",
      geotiff,
      epsgResolver: robustEpsgResolver,
      opacity: state.opacity,
      getTileData,
      renderTile,
      beforeId:
        state.labelsAbove && labelsAvailable ? firstSymbolId : undefined,
      onGeoTIFFLoad: (
        tiff: GeoTIFF,
        options: {
          geographicBounds: { west: number; south: number; east: number; north: number };
          projection: Record<string, unknown>;
        },
      ) => {
        setBandCount(tiff.count);
        setBandNames(readBandNames(tiff));
        if (!isValidGeographicBounds(options.geographicBounds)) {
          // A COG's declared CRS may be missing, unrecognized, or otherwise
          // fail to reproject cleanly to WGS84 — that yields NaN/Infinity or
          // raw projected-CRS values instead of real lng/lat. Feeding those
          // into fitBounds throws an uncaught "Invalid LngLat" deep inside
          // maplibre-gl, so bail out with a clear message instead. Also drop
          // the tile layer (via extentValid) so we don't paint mislocated
          // tiles under that error — the library's tile-placement path clamps
          // coordinates and would otherwise keep drawing.
          setError(
            "Could not determine this COG's geographic extent — its " +
              "coordinate reference system may be missing or unsupported.",
          );
          setExtentValid(false);
          return;
        }
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
    autoStats,
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
          layers={selectOverlayLayers(layer, extentValid)}
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
        message={warning}
        level="warning"
        onDismiss={() => setWarning(null)}
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
