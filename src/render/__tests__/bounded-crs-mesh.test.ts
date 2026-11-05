import { RasterLayer } from "@developmentseed/deck.gl-raster";
import proj4 from "proj4";
import { describe, expect, it } from "vitest";

// Regression test for COGs in bounded projections (World Mollweide), whose
// grid extends past the projection's domain. proj4 doesn't return NaN for
// points outside the Mollweide ellipse: it wraps or clamps their longitude.
// Unpatched, deck.gl-raster meshed those points as if they were valid, and
// drew triangles stretched across the whole map near the poles.

const MOLLWEIDE = "+proj=moll +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";
const toMercator = proj4(MOLLWEIDE, "EPSG:3857");
const HALF = 20037508.342789244; // EPSG:3857 half circumference
const WORLD = 512; // deck.gl common space width (one world)

// Source CRS -> deck.gl common space, as RasterTileset2D projects it.
const project = (x: number, y: number): [number, number] => {
  const [mx, my] = toMercator.forward([x, y]);
  const cy = Math.max(-HALF, Math.min(HALF, my));
  return [(mx / (2 * HALF) + 0.5) * WORLD, (cy / (2 * HALF) + 0.5) * WORLD];
};
const unproject = (cx: number, cy: number): [number, number] => {
  const m = [(cx / WORLD - 0.5) * 2 * HALF, (cy / WORLD - 0.5) * 2 * HALF];
  return toMercator.inverse(m) as [number, number];
};

// Origin of hfp_2017_100m_v1-2_cog.tif (data.source.coop/vizzuality/hfp-100).
const ORIGIN_X = -18040095.696147292;
const ORIGIN_Y = 8824978.852256801;

type Tile = { col: number; row: number; res: number; width: number; height: number };

/** Run the real RasterLayer mesh generation for one tile, Web Mercator mode. */
function meshTile({ col, row, res, width, height }: Tile) {
  const x0 = ORIGIN_X + col * 512 * res;
  const y0 = ORIGIN_Y - row * 512 * res;
  const forwardTransform = (px: number, py: number): [number, number] => [
    x0 + px * res,
    y0 - py * res,
  ];
  let state: Record<string, any> = {};
  const fakeLayer = {
    props: {
      width,
      height,
      reprojectionFns: {
        forwardTransform,
        inverseTransform: (x: number, y: number) => [(x - x0) / res, (y0 - y) / res],
        forwardReproject: project,
        inverseReproject: unproject,
      },
      _wrapX: WORLD,
    },
    context: { viewport: {} },
    setState: (s: Record<string, any>) => (state = { ...state, ...s }),
    raiseError: (e: unknown) => {
      throw e;
    },
  };
  (RasterLayer.prototype as any)._generateMesh.call(fakeLayer);
  const { indices, attributes } = state.mesh;
  const high = attributes.POSITION.value as Float32Array;
  const low = state.positions64Low as Float32Array;
  const uv = attributes.TEXCOORD_0.value as Float32Array;
  const triangles = Array.from(indices.value as Uint32Array);
  const vertex = (i: number) => ({
    x: high[3 * i] + low[3 * i],
    y: high[3 * i + 1] + low[3 * i + 1],
    source: forwardTransform(uv[2 * i] * width, uv[2 * i + 1] * height),
  });
  return { triangles, vertex, tileSize: 512 * res };
}

/** Every drawn vertex must land where its pixel actually is, and no
 * triangle may stretch across a large part of the world. */
function expectFaithfulMesh(tile: Tile) {
  const { triangles, vertex, tileSize } = meshTile(tile);
  expect(triangles.length).toBeGreaterThan(0);
  let worstRoundTrip = 0;
  let widestTriangle = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const xs = [];
    for (const i of triangles.slice(t, t + 3)) {
      const v = vertex(i);
      const wrappedX = ((v.x % WORLD) + WORLD) % WORLD;
      const [bx, by] = unproject(wrappedX, v.y);
      worstRoundTrip = Math.max(
        worstRoundTrip,
        Math.hypot(bx - v.source[0], by - v.source[1]),
      );
      xs.push(v.x);
    }
    widestTriangle = Math.max(widestTriangle, Math.max(...xs) - Math.min(...xs));
  }
  // Streaks are off by millions of metres and span most of the world.
  expect(worstRoundTrip).toBeLessThan(tileSize * 0.05);
  expect(widestTriangle).toBeLessThan(WORLD / 4);
}

describe("RasterLayer mesh for a bounded CRS (Mollweide)", () => {
  it("is unchanged for a tile fully inside the ellipse", () => {
    expectFaithfulMesh({ col: 5, row: 2, res: 6400, width: 512, height: 512 });
  });

  it("drops out-of-domain cells of a tile crossing the ellipse edge", () => {
    // Top-row tile: its top-left corner is outside the ellipse.
    expectFaithfulMesh({ col: 3, row: 0, res: 6400, width: 512, height: 512 });
  });

  it("handles a single tile covering the whole grid, corners all outside", () => {
    expectFaithfulMesh({ col: 0, row: 0, res: 102400, width: 353, height: 173 });
  });

  it("draws nothing for a tile entirely outside the ellipse", () => {
    // Top-left corner tile of a fine level: wholly outside the ellipse.
    const { triangles } = meshTile({ col: 0, row: 0, res: 1600, width: 512, height: 512 });
    expect(triangles).toEqual([]);
  });
});
