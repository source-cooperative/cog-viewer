import { useCallback, useMemo, useSyncExternalStore } from "react";
import type {
  Basemap,
  CogState,
  CogStateUpdate,
  Mode,
  PanelState,
} from "./types";

const VALID_MODES: Mode[] = ["rgb", "single"];
const VALID_BASEMAPS: Basemap[] = ["auto", "light", "dark", "satellite", "off"];
const VALID_PANEL: PanelState[] = ["open", "closed"];

const parseRescale = (raw: string | null): [number, number][] | null => {
  if (!raw) return null;
  return raw.split(";").map((pair) => {
    const [a, b] = pair.split(",").map(Number);
    return [a, b] as [number, number];
  });
};

const parseBands = (raw: string | null): number[] | null =>
  raw ? raw.split(",").map((n) => Number(n)) : null;

const parseNodata = (raw: string | null): number | "off" | null => {
  if (raw === null) return null;
  if (raw === "off") return "off";
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

export function parseCogState(p: URLSearchParams): CogState {
  const modeRaw = p.get("mode");
  const basemapRaw = p.get("basemap");
  return {
    url: p.get("url"),
    mode: VALID_MODES.includes(modeRaw as Mode) ? (modeRaw as Mode) : null,
    bands: parseBands(p.get("bands")),
    rescale: parseRescale(p.get("rescale")),
    colormap: p.get("colormap"),
    nodata: parseNodata(p.get("nodata")),
    opacity: p.has("opacity") ? Number(p.get("opacity")) : 1,
    colorspace: p.get("colorspace"),
    basemap: VALID_BASEMAPS.includes(basemapRaw as Basemap)
      ? (basemapRaw as Basemap)
      : "auto",
    panel: VALID_PANEL.includes(p.get("panel") as PanelState)
      ? (p.get("panel") as PanelState)
      : "closed",
  };
}

export function serializeCogState(s: CogState): URLSearchParams {
  const p = new URLSearchParams();
  if (s.url) p.set("url", s.url);
  if (s.mode) p.set("mode", s.mode);
  if (s.bands) p.set("bands", s.bands.join(","));
  if (s.rescale) p.set("rescale", s.rescale.map((r) => r.join(",")).join(";"));
  if (s.colormap) p.set("colormap", s.colormap);
  if (s.nodata !== null) p.set("nodata", String(s.nodata));
  if (s.opacity !== 1) p.set("opacity", String(s.opacity));
  if (s.colorspace) p.set("colorspace", s.colorspace);
  if (s.basemap !== "auto") p.set("basemap", s.basemap);
  if (s.panel !== "closed") p.set("panel", s.panel);
  return p;
}

const subscribe = (cb: () => void) => {
  window.addEventListener("popstate", cb);
  window.addEventListener("cog-state-change", cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener("cog-state-change", cb);
  };
};

const getSnapshot = () => window.location.search;

export function useCogState() {
  const search = useSyncExternalStore(subscribe, getSnapshot, () => "");
  const state = useMemo(() => parseCogState(new URLSearchParams(search)), [search]);

  const update = useCallback((patch: CogStateUpdate) => {
    const current = parseCogState(new URLSearchParams(window.location.search));
    const next: CogState = { ...current, ...patch };
    const params = serializeCogState(next);
    const qs = params.toString();
    const url = qs
      ? `${window.location.pathname}?${qs}`
      : window.location.pathname;
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new Event("cog-state-change"));
  }, []);

  return [state, update] as const;
}
