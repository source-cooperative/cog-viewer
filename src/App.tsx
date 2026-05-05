import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import {
  createColormapTexture,
  decodeColormapSprite,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import type { Device, Texture } from "@luma.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import { resolveBasemap } from "./basemaps";
import { ControlsPanel } from "./components/ControlsPanel";
import { EmptyState } from "./components/EmptyState";
import {
  buildRgbRenderTile,
  buildSingleRenderTile,
} from "./render/render-pipeline";
import {
  makeRgbaTileLoader,
  makeSingleTileLoader,
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
    if (!state.url) return null;

    const baseProps = {
      id: "cog",
      geotiff: state.url,
      opacity: state.opacity,
      onGeoTIFFLoad: (
        _tiff: unknown,
        options: {
          geographicBounds: { west: number; south: number; east: number; north: number };
        },
      ) => {
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

    if (state.mode === "rgb" && state.bands && state.bands.length > 0) {
      const key = [
        "rgb",
        state.bands.join(","),
        state.rescale?.[0]?.join(",") ?? "",
        String(state.nodata),
      ].join("|");
      return new COGLayer({
        ...baseProps,
        id: `cog:${key}`,
        getTileData: makeRgbaTileLoader(state.bands),
        renderTile: buildRgbRenderTile(state),
      });
    }

    if (
      state.mode === "single" &&
      state.bands &&
      state.bands.length > 0 &&
      colormapTexture
    ) {
      const key = [
        "single",
        String(state.bands[0]),
        state.rescale?.[0]?.join(",") ?? "",
        String(state.nodata),
        state.colormap ?? "viridis",
      ].join("|");
      return new COGLayer({
        ...baseProps,
        id: `cog:${key}`,
        getTileData: makeSingleTileLoader(state.bands[0]),
        renderTile: buildSingleRenderTile(state, colormapTexture),
      });
    }

    return new COGLayer(baseProps);
  }, [
    state.url,
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

      <ControlsPanel state={state} update={update} />

      {!state.url && <EmptyState onSubmit={(url) => update({ url })} />}
    </div>
  );
}
