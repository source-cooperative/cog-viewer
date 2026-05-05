import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import {
  createColormapTexture,
  decodeColormapSprite,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import { GeoTIFF } from "@developmentseed/geotiff";
import type { Device, Texture } from "@luma.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import { resolveBasemap } from "./basemaps";
import { ControlsPanel } from "./components/ControlsPanel";
import { EmptyState } from "./components/EmptyState";
import {
  buildRgbCompositeRenderTile,
  buildSingleCompositeRenderTile,
} from "./render/render-pipeline";
import {
  computeAutoStats,
  readBandCount,
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

  // Construct the GeoTIFF instance ourselves with a 1 MB chunk size instead
  // of letting COGLayer call GeoTIFF.fromUrl(url) (which uses the published
  // 0.6.1 default of 32 KB).
  //
  // Why: when an S3 bucket doesn't expose `Content-Range` via CORS (no
  // `Access-Control-Expose-Headers`), the geotiff library's SourceHttp falls
  // back to reading `Content-Length` from the 206 response and treats *that*
  // (= the chunk size) as the whole-file size. Then `getMaxLength(offset,
  // length)` returns a NEGATIVE value when the IFD chain points past the
  // assumed file end, producing a malformed `bytes=START-END` Range header
  // (end < start). S3 ignores the bad range and serves the entire file with
  // status 200. For NLCD that's a 1.4 GB download per page load.
  //
  // Bumping the prefetch chunk to 1 MB matches the fix on
  // @developmentseed/deck.gl-raster main (ref deck.gl-raster#294,
  // blacha/cogeotiff#1431) — large enough that most COGs' IFD chains fit in
  // the very first range request, so no second range request is needed and
  // the `getMaxLength` bug never trips. Remove this workaround once
  // @developmentseed/geotiff publishes the new default (post-0.6.1).
  useEffect(() => {
    setGeotiff(null);
    setAutoStats(null);
    setBandCount(null);
    setBandNames(null);
    const url = state.url;
    if (!url) return;
    let cancelled = false;
    (async () => {
      try {
        const tiff = await GeoTIFF.fromUrl(url, {
          chunkSize: 1024 * 1024,
          cacheSize: 10 * 1024 * 1024,
        });
        if (!cancelled) setGeotiff(tiff);
      } catch (err) {
        if (!cancelled) console.error("GeoTIFF.fromUrl failed", err);
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
        const stats = await computeAutoStats(geotiff, ctrl.signal);
        if (!ctrl.signal.aborted) setAutoStats(stats);
      } catch (err) {
        if (!ctrl.signal.aborted) console.warn("auto-stats failed", err);
      }
    })();
    return () => ctrl.abort();
  }, [geotiff]);

  // Single-band COGs need the custom path to render with a colormap;
  // COGLayer's defaults render single-band as raw grayscale only. Auto-pick
  // single + colormap when the user hasn't chosen a mode yet.
  useEffect(() => {
    if (bandCount !== null && bandCount < 2 && state.mode === null) {
      update({ mode: "single", bands: [1] });
    }
  }, [bandCount, state.mode, update]);

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
    const fetchedBands = Array.from(
      { length: MAX_BAND_SLOTS },
      (_, i) => i + 1,
    );

    const renderTile =
      state.mode === "single" && colormapTexture
        ? buildSingleCompositeRenderTile(state, colormapTexture)
        : buildRgbCompositeRenderTile(state);

    return new COGLayer({
      id: "cog",
      geotiff,
      opacity: state.opacity,
      getTileData: makeMultiBandTileLoader(fetchedBands),
      renderTile,
      onGeoTIFFLoad: (
        tiff: GeoTIFF,
        options: {
          geographicBounds: { west: number; south: number; east: number; north: number };
        },
      ) => {
        setBandCount(readBandCount(tiff));
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
    });
  }, [
    geotiff,
    state.opacity,
    state.mode,
    state.bands,
    state.rescale,
    state.nodata,
    state.colormap,
    colormapTexture,
  ]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{ longitude: 0, latitude: 0, zoom: 2 }}
        mapStyle={resolveBasemap(state.basemap, prefersDark)}
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
      />

      {!state.url && <EmptyState onSubmit={(url) => update({ url })} />}
    </div>
  );
}
