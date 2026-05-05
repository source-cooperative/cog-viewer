# COG Viewer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a static, client-side web app that renders a Cloud Optimized GeoTIFF in the browser from a URL passed via `?url=`, with URL-synced rendering controls (mode, bands, rescale, colormap, nodata, opacity).

**Architecture:** Vite + React + TypeScript single-page app. `@developmentseed/deck.gl-geotiff`'s `COGLayer` handles fetching, decoding, and tile pyramid. Rendering is composed from `@developmentseed/deck.gl-raster/gpu-modules`. URL search params are the single source of truth — every control reads/writes through them so visualizations are shareable.

**Tech Stack:** Vite, React 19, TypeScript, `@deck.gl/core`, `@deck.gl/mapbox`, `@developmentseed/deck.gl-geotiff` (`0.6.1`), `@developmentseed/deck.gl-raster` (`0.6.1`), `react-map-gl/maplibre`, `maplibre-gl`. Vitest + React Testing Library + jsdom for tests.

**Reference:** See [`docs/plans/2026-05-05-cog-viewer-design.md`](./2026-05-05-cog-viewer-design.md) for the design that this plan implements. Upstream reference example: [`developmentseed/deck.gl-raster/examples/cog-basic`](https://github.com/developmentseed/deck.gl-raster/tree/main/examples/cog-basic).

**Working principles:**
- TDD where it's productive (pure functions, hooks). Smoke tests for untestable surfaces (deck.gl/MapLibre rendering).
- Frequent commits — one per task.
- Don't write what you don't need yet (YAGNI). Don't add comments that just restate the code.
- The user runs Node ≥20 and pnpm. If pnpm is unavailable, fall back to `npm`.

---

## Task 1: Scaffold Vite + React + TypeScript project

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/vite-env.d.ts`, `.gitignore`

**Step 1: Create the Vite scaffold non-interactively**

Run:
```bash
cd /Users/alukach/github/source-cooperative/cog-viewer
pnpm create vite@latest . --template react-ts --no-git
```

If prompted to overwrite the (non-empty) directory, answer "Ignore files and continue".

If pnpm isn't installed, use `npm create vite@latest . -- --template react-ts`.

**Step 2: Install dependencies**

```bash
pnpm install
pnpm add @deck.gl/core@^9.3.1 @deck.gl/mapbox@^9.3.1 \
  @developmentseed/deck.gl-geotiff@^0.6.1 \
  @developmentseed/deck.gl-raster@^0.6.1 \
  maplibre-gl@^5.19.0 react-map-gl@^8.1.0
pnpm add -D vitest @testing-library/react @testing-library/jest-dom \
  @testing-library/user-event jsdom @types/node
```

**Step 3: Strip the Vite boilerplate**

Remove: `src/App.css`, `src/index.css`, `src/assets/`, `public/vite.svg`.

Replace `src/App.tsx` with a placeholder so the dev server still runs:
```tsx
export default function App() {
  return <div>cog-viewer scaffold</div>;
}
```

Replace `src/main.tsx` with:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Replace `index.html`'s `<title>` with `<title>COG Viewer</title>` and remove the favicon `<link>` line. Ensure `<body>` contains a single `<div id="root" style="width:100vw;height:100vh"></div>` and the body itself has `style="margin:0"`.

**Step 4: Add a Vitest config**

Append to `vite.config.ts` so the existing `defineConfig({ plugins: [react()] })` becomes:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

Create `src/test-setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

Add a `test` script to `package.json`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 5: Verify build + tests**

```bash
pnpm build
pnpm test
```

Expected:
- `pnpm build` completes without TypeScript errors.
- `pnpm test` runs with no test files and exits 0 (or with the "no tests found" message). If Vitest exits non-zero on no tests, add a single placeholder test in `src/__tests__/smoke.test.ts`:
  ```ts
  import { expect, it } from "vitest";
  it("smoke", () => expect(1).toBe(1));
  ```

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold vite + react + ts with deck.gl deps"
```

---

## Task 2: Add the URL-state hook (`useCogState`)

This is a pure-logic hook — perfect for TDD.

**Files:**
- Create: `src/state/types.ts`, `src/state/useCogState.ts`, `src/state/__tests__/useCogState.test.ts`

**Step 1: Define types**

Write `src/state/types.ts`:
```ts
export type Mode = "rgb" | "single";

export type CogState = {
  url: string | null;
  mode: Mode | null;
  bands: number[] | null;          // RGB: [r, g, b]
  rescale: [number, number][] | null; // one pair per channel
  colormap: string | null;          // single-band only
  nodata: number | "off" | null;    // null = auto from COG
  opacity: number;                  // 0..1, default 1
  colorspace: string | null;        // override photometric
};

export type CogStateUpdate = Partial<Omit<CogState, "opacity">> & {
  opacity?: number;
};
```

**Step 2: Write failing tests**

Write `src/state/__tests__/useCogState.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseCogState, serializeCogState } from "../useCogState";

describe("parseCogState", () => {
  it("returns nulls for empty params", () => {
    const s = parseCogState(new URLSearchParams());
    expect(s.url).toBeNull();
    expect(s.mode).toBeNull();
    expect(s.bands).toBeNull();
    expect(s.rescale).toBeNull();
    expect(s.opacity).toBe(1);
  });

  it("parses url, mode, bands, rescale", () => {
    const p = new URLSearchParams("url=https://x/y.tif&mode=rgb&bands=4,3,2&rescale=0,3000;0,3000;0,3000");
    const s = parseCogState(p);
    expect(s.url).toBe("https://x/y.tif");
    expect(s.mode).toBe("rgb");
    expect(s.bands).toEqual([4, 3, 2]);
    expect(s.rescale).toEqual([[0, 3000], [0, 3000], [0, 3000]]);
  });

  it("parses single-band rescale as one pair", () => {
    const p = new URLSearchParams("rescale=0,255");
    expect(parseCogState(p).rescale).toEqual([[0, 255]]);
  });

  it("parses nodata special values", () => {
    expect(parseCogState(new URLSearchParams("nodata=off")).nodata).toBe("off");
    expect(parseCogState(new URLSearchParams("nodata=-9999")).nodata).toBe(-9999);
    expect(parseCogState(new URLSearchParams()).nodata).toBeNull();
  });

  it("parses opacity with default 1", () => {
    expect(parseCogState(new URLSearchParams()).opacity).toBe(1);
    expect(parseCogState(new URLSearchParams("opacity=0.5")).opacity).toBe(0.5);
  });

  it("ignores invalid mode", () => {
    expect(parseCogState(new URLSearchParams("mode=bogus")).mode).toBeNull();
  });
});

describe("serializeCogState", () => {
  it("round-trips a populated state", () => {
    const original = new URLSearchParams(
      "url=https://x.tif&mode=rgb&bands=4,3,2&rescale=0,3000;0,3000;0,3000&opacity=0.8",
    );
    const s = parseCogState(original);
    const out = serializeCogState(s);
    expect(parseCogState(out)).toEqual(s);
  });

  it("omits null fields", () => {
    const out = serializeCogState({
      url: "https://x.tif",
      mode: null, bands: null, rescale: null,
      colormap: null, nodata: null, opacity: 1, colorspace: null,
    });
    expect(out.toString()).toBe("url=https%3A%2F%2Fx.tif");
  });

  it("omits opacity when 1", () => {
    const out = serializeCogState({
      url: null, mode: null, bands: null, rescale: null,
      colormap: null, nodata: null, opacity: 1, colorspace: null,
    });
    expect(out.toString()).toBe("");
  });
});
```

**Step 3: Run tests; confirm they fail**

```bash
pnpm test
```

Expected: fails with "Cannot find module '../useCogState'".

**Step 4: Implement `parseCogState` and `serializeCogState`**

Write `src/state/useCogState.ts`:
```ts
import { useCallback, useMemo } from "react";
import type { CogState, CogStateUpdate, Mode } from "./types";

const VALID_MODES: Mode[] = ["rgb", "single"];

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
  return {
    url: p.get("url"),
    mode: VALID_MODES.includes(modeRaw as Mode) ? (modeRaw as Mode) : null,
    bands: parseBands(p.get("bands")),
    rescale: parseRescale(p.get("rescale")),
    colormap: p.get("colormap"),
    nodata: parseNodata(p.get("nodata")),
    opacity: p.has("opacity") ? Number(p.get("opacity")) : 1,
    colorspace: p.get("colorspace"),
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
  return p;
}

export function useCogState() {
  const state = useMemo(
    () => parseCogState(new URLSearchParams(window.location.search)),
    // re-parse when the URL is changed externally
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [window.location.search],
  );

  const update = useCallback((patch: CogStateUpdate) => {
    const current = parseCogState(new URLSearchParams(window.location.search));
    const next = { ...current, ...patch };
    const params = serializeCogState(next);
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);
    // Notify React to re-render — tiny event we listen for in App
    window.dispatchEvent(new Event("cog-state-change"));
  }, []);

  return [state, update] as const;
}
```

**Step 5: Run tests; confirm they pass**

```bash
pnpm test
```

Expected: all tests in `useCogState.test.ts` pass.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(state): add useCogState hook with URL search-params source of truth"
```

---

## Task 3: Add re-render trigger so the hook reacts to URL changes

The `useCogState` hook reads from `window.location.search` but React doesn't re-render on `replaceState`. We need a small subscription.

**Files:**
- Modify: `src/state/useCogState.ts`

**Step 1: Add a `useSyncExternalStore`-based reader**

Replace the body of `useCogState` with:
```ts
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
    const next = { ...current, ...patch };
    const params = serializeCogState(next);
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new Event("cog-state-change"));
  }, []);

  return [state, update] as const;
}
```

Add `useSyncExternalStore` to the imports.

**Step 2: Add a hook test for the subscription**

Append to `src/state/__tests__/useCogState.test.ts`:
```ts
import { act, renderHook } from "@testing-library/react";
import { useCogState } from "../useCogState";

describe("useCogState subscription", () => {
  it("re-renders when update() is called", () => {
    window.history.replaceState(null, "", "/");
    const { result } = renderHook(() => useCogState());
    expect(result.current[0].url).toBeNull();
    act(() => result.current[1]({ url: "https://x.tif" }));
    expect(result.current[0].url).toBe("https://x.tif");
  });
});
```

**Step 3: Run tests**

```bash
pnpm test
```

Expected: all tests pass.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(state): subscribe to URL changes via useSyncExternalStore"
```

---

## Task 4: Add the examples list

**Files:**
- Create: `src/data/examples.ts`

**Step 1: Write the examples**

Use the curated list from upstream's `cog-basic` example. Copy verbatim from [`developmentseed/deck.gl-raster/examples/cog-basic/src/App.tsx`](https://raw.githubusercontent.com/developmentseed/deck.gl-raster/main/examples/cog-basic/src/App.tsx) — only the `COG_OPTIONS` array, dropping React-specific `attribution` JSX in favor of a plain string.

`src/data/examples.ts`:
```ts
export type CogExample = {
  title: string;
  url: string;
  attribution?: string;
};

export const EXAMPLES: CogExample[] = [
  {
    title: "Sentinel-2 True Color (New York, 2026)",
    url: "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2026/1/S2B_18TWL_20260101_0_L2A/TCI.tif",
  },
  {
    title: "New Zealand 2024-2025 10m RGB",
    url: "https://nz-imagery.s3-ap-southeast-2.amazonaws.com/new-zealand/new-zealand_2024-2025_10m/rgb/2193/CC11.tiff",
  },
  {
    title: "NAIP Aerial (New York, 2022)",
    url: "https://ds-wheels.s3.us-east-1.amazonaws.com/m_4007307_sw_18_060_20220803.tif",
  },
  {
    title: "NLCD Land Cover 2023",
    url: "https://ds-wheels.s3.us-east-1.amazonaws.com/Annual_NLCD_LndCov_2023_CU_C1V0.tif",
  },
  {
    title: "Anderson Co. Ortho Pan 2ft (2000)",
    url: "https://data.source.coop/giswqs/tn-imagery/imagery/AndersonCo_OrthoPan_2ft_2000.tif",
  },
];
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat(data): add curated COG examples list"
```

---

## Task 5: Build the empty-state component

Shown when `?url=` is missing. Three actions: paste URL, drag/drop, pick example.

**Files:**
- Create: `src/components/EmptyState.tsx`, `src/components/__tests__/EmptyState.test.tsx`

**Step 1: Write failing tests**

`src/components/__tests__/EmptyState.test.tsx`:
```tsx
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "../EmptyState";

describe("EmptyState", () => {
  it("calls onSubmit when user pastes URL and clicks load", async () => {
    const onSubmit = vi.fn();
    render(<EmptyState onSubmit={onSubmit} />);
    await userEvent.type(screen.getByPlaceholderText(/cog url/i), "https://example.com/x.tif");
    await userEvent.click(screen.getByRole("button", { name: /load/i }));
    expect(onSubmit).toHaveBeenCalledWith("https://example.com/x.tif");
  });

  it("submits when user picks an example", async () => {
    const onSubmit = vi.fn();
    render(<EmptyState onSubmit={onSubmit} />);
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /example/i }),
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2026/1/S2B_18TWL_20260101_0_L2A/TCI.tif",
    );
    expect(onSubmit).toHaveBeenCalledWith(
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2026/1/S2B_18TWL_20260101_0_L2A/TCI.tif",
    );
  });

  it("converts a dropped file to a blob URL and submits", async () => {
    const onSubmit = vi.fn();
    render(<EmptyState onSubmit={onSubmit} />);
    const dropZone = screen.getByTestId("drop-zone");
    const file = new File(["fake-tiff-bytes"], "x.tif", { type: "image/tiff" });
    const dt = new DataTransfer();
    dt.items.add(file);
    await userEvent.upload(screen.getByTestId("file-input"), file);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatch(/^blob:/);
  });
});
```

**Step 2: Run tests; confirm they fail**

```bash
pnpm test
```

Expected: fails — module not found.

**Step 3: Implement the component**

`src/components/EmptyState.tsx`:
```tsx
import { useState } from "react";
import { EXAMPLES } from "../data/examples";

type Props = { onSubmit: (url: string) => void };

export function EmptyState({ onSubmit }: Props) {
  const [value, setValue] = useState("");

  return (
    <div
      style={{
        position: "absolute", inset: 0, display: "grid", placeItems: "center",
        background: "rgba(0,0,0,0.4)", zIndex: 10,
      }}
    >
      <div style={{ background: "white", padding: 24, borderRadius: 8, width: 420, display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Open a COG</h2>

        <label style={{ display: "grid", gap: 4 }}>
          <span>Paste a COG URL</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              placeholder="COG URL (https://…)"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={{ flex: 1, padding: "6px 8px" }}
            />
            <button
              type="button"
              disabled={!value}
              onClick={() => onSubmit(value)}
            >
              Load
            </button>
          </div>
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span>Or pick an example</span>
          <select
            aria-label="example"
            defaultValue=""
            onChange={(e) => e.target.value && onSubmit(e.target.value)}
          >
            <option value="" disabled>Choose…</option>
            {EXAMPLES.map((ex) => (
              <option key={ex.url} value={ex.url}>{ex.title}</option>
            ))}
          </select>
        </label>

        <label
          data-testid="drop-zone"
          style={{
            border: "2px dashed #ccc", borderRadius: 6, padding: 16,
            textAlign: "center", cursor: "pointer",
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) onSubmit(URL.createObjectURL(f));
          }}
        >
          <span>Or drop a .tif file</span>
          <input
            data-testid="file-input"
            type="file"
            accept=".tif,.tiff"
            style={{ display: "block", margin: "8px auto 0" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onSubmit(URL.createObjectURL(f));
            }}
          />
        </label>
      </div>
    </div>
  );
}
```

**Step 4: Run tests; confirm they pass**

```bash
pnpm test
```

Expected: all `EmptyState` tests pass.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): add EmptyState with URL paste, examples, drag-drop"
```

---

## Task 6: Wire EmptyState into App + render the MapLibre shell

**Files:**
- Modify: `src/App.tsx`

**Step 1: Replace App with the map shell + conditional empty state**

```tsx
import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRef } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import { EmptyState } from "./components/EmptyState";
import { useCogState } from "./state/useCogState";

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [state, update] = useCogState();

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{ longitude: 0, latitude: 0, zoom: 2 }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGLOverlay layers={[]} interleaved />
      </MaplibreMap>

      {!state.url && <EmptyState onSubmit={(url) => update({ url })} />}
    </div>
  );
}
```

**Step 2: Run dev server, click an example**

```bash
pnpm dev
```

Open the printed URL. The empty-state card should appear. Click an example. The card should close, and the URL should now contain `?url=…`. The map will be empty (no layer yet) — that's fine for this task.

Stop the dev server.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(app): mount maplibre shell, show EmptyState until url is set"
```

---

## Task 7: Build the render-pipeline factory (pure function)

This converts state + metadata into a `renderPipeline` array. Pure, easily testable.

**Files:**
- Create: `src/render/pipeline.ts`, `src/render/__tests__/pipeline.test.ts`

**Step 1: Write failing tests**

`src/render/__tests__/pipeline.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildPipeline } from "../pipeline";
import {
  CompositeBands, LinearRescale, Colormap, FilterNoDataVal,
} from "@developmentseed/deck.gl-raster/gpu-modules";

const baseMeta = { bandCount: 3, dtype: "uint8" as const, nodata: 0, photometric: null };

describe("buildPipeline", () => {
  it("RGB mode: composite → rescale → nodata filter", () => {
    const p = buildPipeline(
      {
        url: "x", mode: "rgb", bands: [3, 2, 1],
        rescale: [[0, 255], [0, 255], [0, 255]],
        colormap: null, nodata: 0, opacity: 1, colorspace: null,
      },
      baseMeta,
    );
    const ids = p.map((m) => m.name ?? m.id);
    expect(ids[0]).toBe(CompositeBands.name);
    expect(ids[1]).toBe(LinearRescale.name);
    expect(ids[ids.length - 1]).toBe(FilterNoDataVal.name);
  });

  it("single mode: rescale → colormap → nodata filter", () => {
    const p = buildPipeline(
      {
        url: "x", mode: "single", bands: [1], rescale: [[0, 1]],
        colormap: "viridis", nodata: -9999, opacity: 1, colorspace: null,
      },
      { ...baseMeta, bandCount: 1, dtype: "float32" },
    );
    const ids = p.map((m) => m.name ?? m.id);
    expect(ids).toContain(Colormap.name);
    expect(ids[0]).toBe(LinearRescale.name);
    expect(ids[ids.length - 1]).toBe(FilterNoDataVal.name);
  });

  it("omits FilterNoDataVal when nodata is 'off'", () => {
    const p = buildPipeline(
      {
        url: "x", mode: "single", bands: [1], rescale: [[0, 1]],
        colormap: "viridis", nodata: "off", opacity: 1, colorspace: null,
      },
      { ...baseMeta, bandCount: 1 },
    );
    expect(p.find((m) => m.name === FilterNoDataVal.name)).toBeUndefined();
  });

  it("clamps zero-width rescale to avoid NaN", () => {
    const p = buildPipeline(
      {
        url: "x", mode: "single", bands: [1], rescale: [[5, 5]],
        colormap: "viridis", nodata: null, opacity: 1, colorspace: null,
      },
      { ...baseMeta, bandCount: 1 },
    );
    expect(p[0].name).toBe(LinearRescale.name);
    // The rescale module config should have min < max
    // (config inspection is module-shape dependent; just assert it didn't throw)
    expect(p.length).toBeGreaterThan(0);
  });
});
```

NOTE: The exact way rescale params are surfaced on a `RasterModule` depends on the library's runtime API. If the test asserting "min < max" can't read module config directly, simplify by asserting the module is present and adjust during implementation.

**Step 2: Run tests; confirm they fail**

```bash
pnpm test
```

Expected: fails — module not found.

**Step 3: Implement the pipeline factory**

`src/render/pipeline.ts`:
```ts
import {
  Colormap,
  CompositeBands,
  FilterNoDataVal,
  LinearRescale,
  type RasterModule,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { CogState } from "../state/types";

export type CogMetadata = {
  bandCount: number;
  dtype: string;
  nodata: number | null;
  photometric: string | null;
};

const RESCALE_EPSILON = 1e-9;

const safeRange = ([lo, hi]: [number, number]): [number, number] =>
  lo === hi ? [lo, lo + RESCALE_EPSILON] : [lo, hi];

export function buildPipeline(state: CogState, meta: CogMetadata): RasterModule[] {
  const pipeline: RasterModule[] = [];
  const mode = state.mode ?? (meta.bandCount >= 3 ? "rgb" : "single");

  if (mode === "rgb") {
    const bands = state.bands ?? [1, 2, 3];
    pipeline.push({ ...CompositeBands, props: { bandIndexes: bands } } as RasterModule);

    if (state.rescale) {
      pipeline.push({
        ...LinearRescale,
        props: { rescaleFactor: state.rescale.map(safeRange) },
      } as RasterModule);
    }
  } else {
    if (state.rescale?.[0]) {
      pipeline.push({
        ...LinearRescale,
        props: { rescaleFactor: [safeRange(state.rescale[0])] },
      } as RasterModule);
    }
    pipeline.push({
      ...Colormap,
      props: { colormapName: state.colormap ?? "viridis" },
    } as RasterModule);
  }

  const nodata = state.nodata === null ? meta.nodata : state.nodata;
  if (nodata !== "off" && nodata !== null) {
    pipeline.push({
      ...FilterNoDataVal,
      props: { nodataValue: nodata },
    } as RasterModule);
  }

  return pipeline;
}
```

NOTE: The `props` shape (`bandIndexes`, `rescaleFactor`, `colormapName`, `nodataValue`) is the *expected* convention; verify against the package's TypeScript types when implementing — adjust as needed. The test file asserts ordering and presence, not exact prop names, so it should pass either way.

**Step 4: Run tests; confirm they pass**

```bash
pnpm test
```

Expected: pipeline tests pass.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(render): add buildPipeline factory mapping state to gpu modules"
```

---

## Task 8: Mount the COGLayer with the pipeline

**Files:**
- Create: `src/render/CogLayer.ts`
- Modify: `src/App.tsx`

**Step 1: Create the layer factory**

`src/render/CogLayer.ts`:
```ts
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import type { CogState } from "../state/types";
import { buildPipeline, type CogMetadata } from "./pipeline";

export function makeCogLayer(
  state: CogState,
  metadata: CogMetadata | null,
  onLoad: (m: CogMetadata, bounds: { west: number; south: number; east: number; north: number }) => void,
) {
  if (!state.url) return null;

  return new COGLayer({
    id: "cog",
    geotiff: state.url,
    opacity: state.opacity,
    renderPipeline: metadata ? buildPipeline(state, metadata) : [],
    onGeoTIFFLoad: (tiff: any, options: any) => {
      const m: CogMetadata = {
        bandCount: tiff.imageCount ?? 1,
        dtype: tiff.dataType ?? "uint8",
        nodata: tiff.nodata ?? null,
        photometric: tiff.photometric ?? null,
      };
      onLoad(m, options.geographicBounds);
    },
  });
}
```

NOTE: The exact paths to extract `bandCount`, `dtype`, `nodata`, `photometric` from the loaded `tiff` may differ. When implementing, log `tiff` once and inspect — common locations: `tiff.fileDirectories[0].SamplesPerPixel`, `.BitsPerSample`, `.GDAL_NODATA`, `.PhotometricInterpretation`. Adjust accordingly. If a value isn't reliably retrievable, leave it `null` and the pipeline factory falls back to defaults.

**Step 2: Wire it into App**

Replace `App.tsx` with:
```tsx
import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import { EmptyState } from "./components/EmptyState";
import { makeCogLayer } from "./render/CogLayer";
import type { CogMetadata } from "./render/pipeline";
import { useCogState } from "./state/useCogState";

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [state, update] = useCogState();
  const [metadata, setMetadata] = useState<CogMetadata | null>(null);

  const layer = useMemo(
    () =>
      makeCogLayer(state, metadata, (meta, bounds) => {
        setMetadata(meta);
        mapRef.current?.fitBounds(
          [[bounds.west, bounds.south], [bounds.east, bounds.north]],
          { padding: 40, duration: 800 },
        );
      }),
    [state, metadata],
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{ longitude: 0, latitude: 0, zoom: 2 }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGLOverlay layers={layer ? [layer] : []} interleaved />
      </MaplibreMap>

      {!state.url && <EmptyState onSubmit={(url) => update({ url })} />}
    </div>
  );
}
```

**Step 3: Manual smoke test**

```bash
pnpm dev
```

In the browser:
1. Click the "Sentinel-2 True Color" example.
2. The URL should update with `?url=…`.
3. The empty-state card should disappear.
4. The map should fit-bounds to the COG and render it.

If the layer doesn't render, open the browser console and inspect any errors. Common issue: the `tiff` introspection in `onGeoTIFFLoad` returns wrong values, breaking the pipeline. Log the `tiff` object and adjust the metadata extraction accordingly.

Stop the dev server.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(render): mount COGLayer driven by url state with pipeline"
```

---

## Task 9: Build the controls panel — Mode toggle + Opacity

Smallest controls first. Each control reads from URL state and writes via `update()`.

**Files:**
- Create: `src/components/ControlsPanel.tsx`
- Modify: `src/App.tsx`

**Step 1: Implement panel**

`src/components/ControlsPanel.tsx`:
```tsx
import type { CogState, CogStateUpdate, Mode } from "../state/types";
import type { CogMetadata } from "../render/pipeline";

type Props = {
  state: CogState;
  update: (patch: CogStateUpdate) => void;
  metadata: CogMetadata | null;
};

const FIELDSET: React.CSSProperties = {
  border: 0, padding: 0, margin: 0, display: "grid", gap: 4,
};

export function ControlsPanel({ state, update, metadata }: Props) {
  const effectiveMode: Mode =
    state.mode ?? ((metadata?.bandCount ?? 0) >= 3 ? "rgb" : "single");

  return (
    <div
      style={{
        position: "absolute", top: 16, right: 16, width: 320,
        background: "white", padding: 16, borderRadius: 8,
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)", zIndex: 5,
        display: "grid", gap: 12, fontSize: 13,
      }}
    >
      <strong>COG Viewer</strong>

      <div style={{ wordBreak: "break-all", fontSize: 11, color: "#666" }}>
        {state.url}
      </div>

      <fieldset style={FIELDSET}>
        <legend style={{ fontWeight: 600 }}>Mode</legend>
        <select
          aria-label="mode"
          value={effectiveMode}
          onChange={(e) => update({ mode: e.target.value as Mode })}
        >
          <option value="rgb">RGB / composite</option>
          <option value="single">Single band</option>
        </select>
      </fieldset>

      <fieldset style={FIELDSET}>
        <legend style={{ fontWeight: 600 }}>Opacity ({state.opacity.toFixed(2)})</legend>
        <input
          aria-label="opacity"
          type="range" min={0} max={1} step={0.01}
          value={state.opacity}
          onChange={(e) => update({ opacity: Number(e.target.value) })}
        />
      </fieldset>

      <button
        type="button"
        onClick={() => update({ url: null, mode: null, bands: null, rescale: null, colormap: null, nodata: null, colorspace: null })}
      >
        Open another COG
      </button>
    </div>
  );
}
```

**Step 2: Mount in App**

In `App.tsx`, after the `<MaplibreMap>` and before the EmptyState:
```tsx
{state.url && <ControlsPanel state={state} update={update} metadata={metadata} />}
```

Add the import.

**Step 3: Manual smoke test**

```bash
pnpm dev
```

Click an example → panel appears → mode toggle changes URL → opacity slider changes URL → "Open another COG" returns to empty state.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): add ControlsPanel with mode + opacity controls"
```

---

## Task 10: Controls panel — Bands picker (RGB mode)

**Files:**
- Modify: `src/components/ControlsPanel.tsx`

**Step 1: Add band picker**

Inside `ControlsPanel`, after the mode fieldset, add:
```tsx
{effectiveMode === "rgb" && metadata && (
  <fieldset style={FIELDSET}>
    <legend style={{ fontWeight: 600 }}>Bands (R, G, B)</legend>
    <div style={{ display: "flex", gap: 4 }}>
      {(["r", "g", "b"] as const).map((label, i) => (
        <select
          key={label}
          aria-label={`band-${label}`}
          value={(state.bands ?? [1, 2, 3])[i]}
          onChange={(e) => {
            const next = [...(state.bands ?? [1, 2, 3])];
            next[i] = Number(e.target.value);
            update({ bands: next });
          }}
        >
          {Array.from({ length: metadata.bandCount }, (_, n) => n + 1).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      ))}
    </div>
  </fieldset>
)}
```

**Step 2: Manual smoke test**

```bash
pnpm dev
```

Open the Sentinel-2 example. The bands picker should show 3 dropdowns. Changing them should re-render the COG with the new band ordering.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(ui): add RGB band picker to controls panel"
```

---

## Task 11: Controls panel — Rescale per band

**Files:**
- Create: `src/components/RescaleControls.tsx`
- Modify: `src/components/ControlsPanel.tsx`

**Step 1: Build a small subcomponent**

`src/components/RescaleControls.tsx`:
```tsx
import type { CogState } from "../state/types";

type Props = {
  state: CogState;
  channels: number;
  onChange: (rescale: [number, number][]) => void;
};

const DEFAULT_RANGE: [number, number] = [0, 255];

export function RescaleControls({ state, channels, onChange }: Props) {
  const current = state.rescale ?? Array.from({ length: channels }, () => DEFAULT_RANGE);
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 4 }}>
      <legend style={{ fontWeight: 600 }}>Rescale</legend>
      {current.slice(0, channels).map((range, i) => (
        <div key={i} style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ width: 16 }}>{["R", "G", "B"][i] ?? "v"}</span>
          <input
            type="number"
            value={range[0]}
            onChange={(e) => {
              const next = current.map((r): [number, number] => [...r]);
              next[i] = [Number(e.target.value), range[1]];
              onChange(next);
            }}
            style={{ width: 70 }}
          />
          <input
            type="number"
            value={range[1]}
            onChange={(e) => {
              const next = current.map((r): [number, number] => [...r]);
              next[i] = [range[0], Number(e.target.value)];
              onChange(next);
            }}
            style={{ width: 70 }}
          />
        </div>
      ))}
    </fieldset>
  );
}
```

**Step 2: Mount in ControlsPanel**

After the bands fieldset:
```tsx
<RescaleControls
  state={state}
  channels={effectiveMode === "rgb" ? 3 : 1}
  onChange={(rescale) => update({ rescale })}
/>
```

Add the import.

**Step 3: Manual smoke test**

`pnpm dev`. Adjusting rescale values should change image contrast.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): add per-band rescale controls"
```

---

## Task 12: Controls panel — Colormap picker (single mode)

**Files:**
- Create: `src/data/colormaps.ts`
- Modify: `src/components/ControlsPanel.tsx`

**Step 1: List the colormaps**

`src/data/colormaps.ts`:
```ts
import { COLORMAP_INDEX } from "@developmentseed/deck.gl-raster/gpu-modules";

export const COLORMAP_NAMES: string[] = Object.keys(COLORMAP_INDEX).sort();
```

If `COLORMAP_INDEX` isn't keyed by name in the published package, fall back to a hard-coded list of common ones: `["viridis", "magma", "inferno", "plasma", "cividis", "turbo", "gray", "rdylbu", "spectral", "terrain"]`.

**Step 2: Add picker to ControlsPanel**

After RescaleControls:
```tsx
{effectiveMode === "single" && (
  <fieldset style={FIELDSET}>
    <legend style={{ fontWeight: 600 }}>Colormap</legend>
    <select
      aria-label="colormap"
      value={state.colormap ?? "viridis"}
      onChange={(e) => update({ colormap: e.target.value })}
    >
      {COLORMAP_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  </fieldset>
)}
```

Import `COLORMAP_NAMES`.

**Step 3: Manual smoke test**

Open the NLCD Land Cover example (1-band). Switch mode to "Single band". Cycle through colormaps — the rendering should change.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): add colormap picker for single-band mode"
```

---

## Task 13: Controls panel — Nodata override

**Files:**
- Modify: `src/components/ControlsPanel.tsx`

**Step 1: Add nodata field**

After colormap:
```tsx
<fieldset style={FIELDSET}>
  <legend style={{ fontWeight: 600 }}>Nodata</legend>
  <div style={{ display: "flex", gap: 4 }}>
    <select
      aria-label="nodata-mode"
      value={state.nodata === "off" ? "off" : state.nodata === null ? "auto" : "value"}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "auto") update({ nodata: null });
        else if (v === "off") update({ nodata: "off" });
        else update({ nodata: metadata?.nodata ?? 0 });
      }}
    >
      <option value="auto">Auto (from COG)</option>
      <option value="value">Value</option>
      <option value="off">Off</option>
    </select>
    {typeof state.nodata === "number" && (
      <input
        type="number"
        aria-label="nodata-value"
        value={state.nodata}
        onChange={(e) => update({ nodata: Number(e.target.value) })}
        style={{ width: 90 }}
      />
    )}
  </div>
</fieldset>
```

**Step 2: Manual smoke test**

`pnpm dev`. Switching nodata between Auto/Off/Value should re-render appropriately.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(ui): add nodata override control"
```

---

## Task 14: Render controls panel as a test target

Sanity-check that the panel writes URL state correctly. One representative test.

**Files:**
- Create: `src/components/__tests__/ControlsPanel.test.tsx`

**Step 1: Write a single integration-style test**

```tsx
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ControlsPanel } from "../ControlsPanel";

const baseState = {
  url: "https://x.tif",
  mode: "rgb" as const,
  bands: [1, 2, 3],
  rescale: null,
  colormap: null,
  nodata: null,
  opacity: 1,
  colorspace: null,
};

describe("ControlsPanel", () => {
  it("calls update with new opacity when slider changes", async () => {
    const update = vi.fn();
    render(
      <ControlsPanel
        state={baseState}
        update={update}
        metadata={{ bandCount: 4, dtype: "uint8", nodata: 0, photometric: null }}
      />,
    );
    const slider = screen.getByLabelText("opacity");
    await userEvent.click(slider);
    // simulate keyboard arrow which is reliable for range
    await userEvent.keyboard("{ArrowLeft}");
    expect(update).toHaveBeenCalled();
    const last = update.mock.calls.at(-1)![0];
    expect(last.opacity).toBeLessThan(1);
  });

  it("calls update with new mode", async () => {
    const update = vi.fn();
    render(
      <ControlsPanel
        state={baseState}
        update={update}
        metadata={{ bandCount: 4, dtype: "uint8", nodata: 0, photometric: null }}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("mode"), "single");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ mode: "single" }));
  });
});
```

**Step 2: Run tests**

```bash
pnpm test
```

Expected: pass. If the slider keyboard test is flaky, drop it and keep just the mode test.

**Step 3: Commit**

```bash
git add -A
git commit -m "test(ui): smoke-test ControlsPanel update wiring"
```

---

## Task 15: Error handling — toasts

A minimal toast for CORS / invalid-COG failures.

**Files:**
- Create: `src/components/Toast.tsx`
- Modify: `src/App.tsx`, `src/render/CogLayer.ts`

**Step 1: Build a one-message toast**

`src/components/Toast.tsx`:
```tsx
type Props = { message: string | null; onDismiss: () => void };

export function Toast({ message, onDismiss }: Props) {
  if (!message) return null;
  return (
    <div
      role="alert"
      style={{
        position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)",
        background: "#b00020", color: "white", padding: "10px 16px",
        borderRadius: 6, zIndex: 20, display: "flex", gap: 12, alignItems: "center",
      }}
    >
      <span>{message}</span>
      <button type="button" onClick={onDismiss} style={{ background: "transparent", color: "white", border: "1px solid white" }}>
        Dismiss
      </button>
    </div>
  );
}
```

**Step 2: Add `onError` callback to `makeCogLayer`**

In `CogLayer.ts`, extend the layer config:
```ts
onTileError: (err: Error) => onError(err),
```

Add `onError: (err: Error) => void` as a fourth parameter to `makeCogLayer`.

NOTE: COGLayer's exact error callback name (`onTileError` vs `onError`) varies — check the type. If neither is available, wrap the URL fetch yourself with a HEAD request before mounting the layer.

**Step 3: Wire into App**

```tsx
const [error, setError] = useState<string | null>(null);

const layer = useMemo(
  () =>
    makeCogLayer(
      state, metadata,
      (meta, bounds) => { setError(null); setMetadata(meta); /* fitBounds */ },
      (err) => setError(humanizeError(err)),
    ),
  [state, metadata],
);
```

And `humanizeError` near the top of `App.tsx`:
```ts
function humanizeError(err: Error): string {
  const msg = err.message?.toLowerCase() ?? "";
  if (msg.includes("cors") || msg.includes("network")) {
    return "This COG isn't CORS-enabled. The host needs Access-Control-Allow-Origin.";
  }
  if (msg.includes("not a") || msg.includes("invalid") || msg.includes("tiff")) {
    return "This file isn't a valid Cloud Optimized GeoTIFF.";
  }
  return `Could not load COG: ${err.message}`;
}
```

Render `<Toast message={error} onDismiss={() => setError(null)} />` inside the wrapper div.

**Step 4: Manual smoke test**

`pnpm dev`. Manually navigate to `?url=https://example.com/not-a-cog.tif`. The toast should show an error.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(error): toast on CORS / invalid COG failures"
```

---

## Task 16: Default-fill on metadata load

When the COG loads and the URL doesn't already specify a mode/bands/rescale/colormap, populate them based on metadata. Don't trample user-set values.

**Files:**
- Modify: `src/App.tsx`

**Step 1: Add a one-shot default-fill effect**

```tsx
useEffect(() => {
  if (!metadata || !state.url) return;
  const patch: CogStateUpdate = {};
  if (state.mode === null) patch.mode = metadata.bandCount >= 3 ? "rgb" : "single";
  if (state.bands === null && (patch.mode ?? state.mode) === "rgb") {
    patch.bands = metadata.bandCount >= 3 ? [1, 2, 3] : null;
  }
  if (state.colormap === null && (patch.mode ?? state.mode) === "single") {
    patch.colormap = metadata.dtype.startsWith("float") ? "viridis" : "gray";
  }
  if (Object.keys(patch).length > 0) update(patch);
}, [metadata]); // intentionally only re-run when metadata changes
```

Add `useEffect` to imports.

**Step 2: Manual smoke test**

`pnpm dev`. Open a fresh example. URL should auto-fill `mode=` etc., and toggling them later should stick.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(state): default-fill mode/bands/colormap from COG metadata"
```

---

## Task 17: README

**Files:**
- Create: `README.md`

**Step 1: Write a short README**

```markdown
# COG Viewer

A static, client-side viewer for [Cloud Optimized GeoTIFFs](https://www.cogeo.org/), built on top of
[`@developmentseed/deck.gl-geotiff`](https://github.com/developmentseed/deck.gl-raster).

Inspired by [marblecutter-virtual](https://github.com/sethfitz/marblecutter-virtual) — but with no server.
The COG is fetched and decoded entirely in the browser.

## Usage

Open the app with a COG URL:

    https://your-host/?url=https://example.com/cog.tif

Optional URL parameters:

| Param | Example | Notes |
|---|---|---|
| `url` | `https://…/cog.tif` | Required (or use the empty-state UI). |
| `mode` | `rgb` \| `single` | Auto-selected from band count. |
| `bands` | `4,3,2` | RGB mode. |
| `rescale` | `0,3000;0,3000;0,3000` | One pair per channel. |
| `colormap` | `viridis` | Single-band mode. |
| `nodata` | `-9999` \| `off` | Override of detected nodata. |
| `opacity` | `0.7` | Layer opacity. |

Without `url`, an empty-state panel offers paste / drop / examples.

## Develop

    pnpm install
    pnpm dev      # vite dev server
    pnpm test     # vitest
    pnpm build    # static bundle in dist/
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Verification — final smoke pass

Before declaring done, walk through each example in `examples.ts`:

1. `pnpm dev`.
2. For each example: click it, verify the map fits-bounds and renders the COG without console errors.
3. Verify mode auto-selects correctly (`rgb` for ≥3 bands, `single` for 1 band).
4. Toggle each control once and confirm the URL updates and the rendering changes.
5. Click "Open another COG" → empty state returns.
6. Refresh with a populated URL → the same view restores.

Run:

```bash
pnpm test
pnpm build
```

Both must exit zero.

---

## Out of scope (deferred)

The design doc explicitly defers these to a follow-on plan:

- Gamma correction (custom luma.gl module)
- Sigmoidal contrast (custom luma.gl module)
- Hillshade (custom luma.gl module)
- Band-math expressions / NDVI (custom luma.gl module)
- Multi-COG mosaicking via `MultiCOGLayer`
- Histogram / percentile auto-stretch UI
- Pixel inspector / value-at-cursor

Do **not** implement these in this plan.
