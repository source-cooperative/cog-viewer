import { RasterLayer } from "@developmentseed/deck.gl-raster";
import { makeClampedForwardTo3857 } from "@developmentseed/proj";
import proj4 from "proj4";
import { describe, expect, it } from "vitest";

// Regression test for COGs in bounded projections (World Mollweide), whose
// grid extends past the projection's domain. proj4 doesn't return NaN for
// points outside the Mollweide ellipse: it wraps or clamps their longitude.
// Unpatched, deck.gl-raster meshed those points as if they were valid, and
// drew triangles stretched across the whole map near the poles.

const MOLLWEIDE = "+proj=moll +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";
const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";
const HALF = 20037508.342789244; // EPSG:3857 half circumference
const WORLD = 512; // deck.gl common space width (one world)
const MAX_MERCATOR_LAT = 85.05112877980659;

type XY = [number, number];

/** Source CRS <-> deck.gl common space, as RasterTileset2D builds them. */
function commonSpaceFns(crs: string) {
  const to3857 = proj4(crs, "EPSG:3857");
  const to4326 = proj4(crs, "EPSG:4326");
  const forward3857 = makeClampedForwardTo3857(
    (x, y) => to3857.forward([x, y], false) as XY,
    (x, y) => to4326.forward([x, y], false) as XY,
  );
  return {
    project: (x: number, y: number): XY => {
      const [mx, my] = forward3857(x, y);
      return [(mx / (2 * HALF) + 0.5) * WORLD, (my / (2 * HALF) + 0.5) * WORLD];
    },
    unproject: (cx: number, cy: number): XY =>
      to3857.inverse([(cx / WORLD - 0.5) * 2 * HALF, (cy / WORLD - 0.5) * 2 * HALF], false) as XY,
    latitude: (x: number, y: number) => to4326.forward([x, y], false)[1],
  };
}

const mollweide = commonSpaceFns(MOLLWEIDE);
const wgs84 = commonSpaceFns(WGS84);

/** The UV band of a tile inside Web Mercator's latitude range, as
 * RasterTileset2D seeds it, or undefined if the whole tile is inside. */
function webMercatorBand(topLat: number, bottomLat: number) {
  const vAt = (lat: number) => (lat - topLat) / (bottomLat - topLat);
  const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
  const v0 = clamp01(Math.min(vAt(MAX_MERCATOR_LAT), vAt(-MAX_MERCATOR_LAT)));
  const v1 = clamp01(Math.max(vAt(MAX_MERCATOR_LAT), vAt(-MAX_MERCATOR_LAT)));
  if (v0 === 0 && v1 === 1) return undefined;
  return {
    uvs: [0, v0, 1, v0, 0, v1, 1, v1],
    triangles: [3, 0, 2, 0, 3, 1],
    halfedges: [3, -1, -1, 0, -1, -1],
  };
}

// Origin of hfp_2017_100m_v1-2_cog.tif (data.source.coop/vizzuality/hfp-100).
const ORIGIN_X = -18040095.696147292;
const ORIGIN_Y = 8824978.852256801;

type Tile = {
  col: number;
  row: number;
  res: number;
  width: number;
  height: number;
  fns?: ReturnType<typeof commonSpaceFns>;
  originX?: number;
  originY?: number;
  /** Seed the mesh with the Web Mercator latitude band, as production does. */
  band?: boolean;
};

/** Run the real RasterLayer mesh generation for one tile, Web Mercator mode. */
function meshTile({
  col,
  row,
  res,
  width,
  height,
  fns = mollweide,
  originX = ORIGIN_X,
  originY = ORIGIN_Y,
  band = false,
}: Tile) {
  const x0 = originX + col * 512 * res;
  const y0 = originY - row * 512 * res;
  const forwardTransform = (px: number, py: number): XY => [x0 + px * res, y0 - py * res];
  let state: Record<string, any> = {};
  const fakeLayer = {
    props: {
      width,
      height,
      reprojectionFns: {
        forwardTransform,
        inverseTransform: (x: number, y: number) => [(x - x0) / res, (y0 - y) / res],
        forwardReproject: fns.project,
        inverseReproject: fns.unproject,
      },
      initialTriangulation: band
        ? webMercatorBand(fns.latitude(x0, y0), fns.latitude(x0, y0 - height * res))
        : undefined,
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
    u: uv[2 * i],
    source: forwardTransform(uv[2 * i] * width, uv[2 * i + 1] * height),
  });
  return { triangles, vertex, tileSize: 512 * res, adaptive: state.reprojector !== undefined };
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
      const [bx, by] = mollweide.unproject(wrappedX, v.y);
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

/** The drawn vertices' u range and largest y. */
function extent(tile: Tile) {
  const { triangles, vertex, adaptive } = meshTile(tile);
  const drawn = [...new Set(triangles)].map(vertex);
  return {
    adaptive,
    minU: Math.min(...drawn.map((v) => v.u)),
    maxU: Math.max(...drawn.map((v) => v.u)),
    maxY: Math.max(...drawn.map((v) => v.y)),
  };
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

describe("RasterLayer mesh for a global geographic grid (EPSG:4326)", () => {
  const geographic = { fns: wgs84, width: 512, height: 256, col: 0, row: 0 };

  it("draws a 0-360° longitude grid in full", () => {
    const e = extent({ ...geographic, res: 360 / 512, originX: 0, originY: 60, height: 128 });
    expect([e.minU, e.maxU]).toEqual([0, 1]);
  });

  it("draws a grid whose edges overshoot ±180° in full", () => {
    const e = extent({ ...geographic, res: 360.02 / 512, originX: -180.01, originY: 60, height: 128 });
    expect([e.minU, e.maxU]).toEqual([0, 1]);
  });

  it("keeps the adaptive mesh and latitude band for a tile reaching the pole", () => {
    const e = extent({ ...geographic, res: 180 / 512, originX: -180, originY: 90, band: true });
    expect(e.adaptive).toBe(true);
    expect(e.maxY).toBeLessThanOrEqual(WORLD + 1e-6);
  });
});
