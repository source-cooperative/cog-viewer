import { useCallback, useMemo, useSyncExternalStore } from "react";
import type {
  Basemap,
  CogState,
  CogStateUpdate,
  Mode,
  PanelState,
  Sigmoidal,
} from "./types";

const VALID_MODES: Mode[] = ["rgb", "single"];
const VALID_BASEMAPS: Basemap[] = ["auto", "light", "dark", "satellite", "off"];
const VALID_PANEL: PanelState[] = ["open", "closed"];

const parseRescale = (raw: string | null): [number, number][] | null => {
  if (!raw) return null;
  const pairs: [number, number][] = [];
  for (const part of raw.split(";")) {
    const halves = part.split(",");
    if (halves.length !== 2) return null;
    const a = Number(halves[0]);
    const b = Number(halves[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    pairs.push([a, b]);
  }
  return pairs.length > 0 ? pairs : null;
};

const parseBands = (raw: string | null): number[] | null => {
  if (!raw) return null;
  const out: number[] = [];
  for (const tok of raw.split(",")) {
    const n = Number(tok);
    if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) return null;
    out.push(n);
  }
  return out.length > 0 ? out : null;
};

const parseNodata = (raw: string | null): number | "off" | null => {
  if (raw === null || raw === "") return null;
  if (raw === "off") return "off";
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

const parseOpacity = (raw: string | null): number => {
  if (raw === null || raw === "") return 1;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
};

const parseGamma = (raw: string | null): number => {
  if (raw === null || raw === "") return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
};

const parseSigmoidal = (raw: string | null): Sigmoidal | null => {
  if (!raw) return null;
  const parts = raw.split(",");
  if (parts.length !== 2) return null;
  const contrast = Number(parts[0]);
  const bias = Number(parts[1]);
  if (!Number.isFinite(contrast) || !Number.isFinite(bias)) return null;
  return { contrast, bias };
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
    opacity: parseOpacity(p.get("opacity")),
    colorspace: p.get("colorspace"),
    basemap: VALID_BASEMAPS.includes(basemapRaw as Basemap)
      ? (basemapRaw as Basemap)
      : "auto",
    panel: VALID_PANEL.includes(p.get("panel") as PanelState)
      ? (p.get("panel") as PanelState)
      : "closed",
    gamma: parseGamma(p.get("gamma")),
    sigmoidal: parseSigmoidal(p.get("sigmoidal")),
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
  if (s.gamma !== 1) p.set("gamma", String(s.gamma));
  if (s.sigmoidal) p.set("sigmoidal", `${s.sigmoidal.contrast},${s.sigmoidal.bias}`);
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
    const next: CogState = { ...current };
    for (const key in patch) {
      const v = (patch as Record<string, unknown>)[key];
      if (v !== undefined) (next as Record<string, unknown>)[key] = v;
    }
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
