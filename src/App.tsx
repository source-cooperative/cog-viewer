import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo, useRef, useSyncExternalStore } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import { resolveBasemap } from "./basemaps";
import { BasemapPicker } from "./components/BasemapPicker";
import { EmptyState } from "./components/EmptyState";
import { buildRgbRenderTile } from "./render/render-pipeline";
import { makeRgbaTileLoader } from "./render/tile-loader";
import { useCogState } from "./state/useCogState";

const darkMql = window.matchMedia("(prefers-color-scheme: dark)");
const subscribeColorScheme = (cb: () => void) => {
  darkMql.addEventListener("change", cb);
  return () => darkMql.removeEventListener("change", cb);
};
const getColorSchemeSnapshot = () => darkMql.matches;
const usePrefersDark = () =>
  useSyncExternalStore(subscribeColorScheme, getColorSchemeSnapshot, () => false);

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [state, update] = useCogState();
  const prefersDark = usePrefersDark();

  const layer = useMemo(() => {
    if (!state.url) return null;

    const baseProps = {
      id: "cog",
      geotiff: state.url,
      opacity: state.opacity,
      onGeoTIFFLoad: (_tiff: unknown, options: {
        geographicBounds: { west: number; south: number; east: number; north: number };
      }) => {
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
      const bandsKey = state.bands.join(",");
      const rescaleKey = state.rescale?.[0]?.join(",") ?? "";
      const nodataKey = String(state.nodata);
      return new COGLayer({
        ...baseProps,
        getTileData: makeRgbaTileLoader(state.bands),
        renderTile: buildRgbRenderTile(state),
        updateTriggers: {
          getTileData: [bandsKey],
          renderTile: [bandsKey, rescaleKey, nodataKey],
        },
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
  ]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{ longitude: 0, latitude: 0, zoom: 2 }}
        mapStyle={resolveBasemap(state.basemap, prefersDark)}
      >
        <DeckGLOverlay layers={layer ? [layer] : []} interleaved />
      </MaplibreMap>

      <BasemapPicker
        value={state.basemap}
        onChange={(basemap) => update({ basemap })}
      />

      {!state.url && <EmptyState onSubmit={(url) => update({ url })} />}
    </div>
  );
}
