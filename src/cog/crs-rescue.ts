import type { GeoTIFF } from "@developmentseed/geotiff";
import {
  epsgResolver as defaultEpsgResolver,
  parseWkt,
  type EpsgResolver,
  type ProjectedCRS,
  type ProjectionDefinition,
} from "@developmentseed/proj";

/**
 * Rescue for COGs whose projection @developmentseed/geotiff can't parse but
 * proj4 (used downstream by @developmentseed/deck.gl-geotiff) can render.
 *
 * The concrete case: GeoTIFF `ProjCoordTransGeoKey` (3075) = 28,
 * `CylindricalEqualArea` (World / Lambert Cylindrical Equal Area — ESRI:54034,
 * the EASE-Grid family). GDAL/libgeotiff write code 28, but the OGC GeoTIFF
 * standard's own transform list stops at 27, so the upstream `_buildConversion`
 * switch hits its `default` and throws `Unsupported coordinate transformation
 * type: 28`. Accessing `geotiff.crs` therefore throws, which crashes the
 * MetadataPanel (a synchronous `.crs` read during render) and stops the
 * COGLayer from reprojecting.
 *
 * proj4 *does* implement Cylindrical Equal Area (`+proj=cea`), and its only name
 * alias is the literal `"cea"`. So the fix is to build the projection definition
 * ourselves: emit the PROJJSON the upstream switch would have produced for code
 * 28 — but with `method.name = "cea"` so proj4 resolves it — run it through the
 * same `parseWkt` the library uses, and patch the one field proj4's `cea.js`
 * reads that wkt-parser doesn't populate (`lat_ts`, which it names `lat1`).
 *
 * We can't hand a raw definition straight to the COGLayer: it reads
 * `geotiff.crs` and, for a *number*, calls its `epsgResolver` prop, whose return
 * value goes to proj4 unchanged; for an *object*, it re-runs `parseWkt` (which
 * would strip our `lat_ts` patch again). So we seed `geotiff._crs` with a
 * sentinel numeric code and register the definition under that code, then hand
 * the COGLayer a {@link rescuingEpsgResolver} that returns our definition for
 * sentinels and delegates to the library default for real EPSG codes.
 */

/** GeoTIFF ProjCoordTransGeoKey code we can rescue. */
const CT_CYLINDRICAL_EQUAL_AREA = 28;

/** WGS 84 ellipsoid — the default when a COG omits ellipsoid geo keys. */
const WGS84_SEMI_MAJOR = 6378137.0;
const WGS84_INV_FLATTENING = 298.257223563;

/**
 * Sentinel codes are minted well above any real EPSG/ESRI code (which stay below
 * ~1e6) so {@link rescuingEpsgResolver} can tell our overrides from codes the
 * library default should resolve over the network.
 */
const SENTINEL_BASE = 100_000_000;

/** The subset of GeoKeyDirectory fields we read to rebuild a projection. */
type ProjGeoKeys = {
  projMethod?: number | null;
  projStdParallel1?: number | null;
  projNatOriginLong?: number | null;
  projFalseEasting?: number | null;
  projFalseNorthing?: number | null;
  ellipsoidSemiMajorAxis?: number | null;
  ellipsoidInvFlattening?: number | null;
  ellipsoidSemiMinorAxis?: number | null;
  projectedCitation?: string | null;
  citation?: string | null;
};

const num = (v: number | null | undefined, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/** Build the PROJJSON ellipsoid from the geo keys, defaulting to WGS 84. */
function ellipsoidJson(gkd: ProjGeoKeys): ProjectedCRS["base_crs"]["datum"] {
  const a = gkd.ellipsoidSemiMajorAxis;
  const ellipsoid: { name: string; semi_major_axis: number; inverse_flattening?: number; semi_minor_axis?: number } =
    { name: "unknown", semi_major_axis: a ?? WGS84_SEMI_MAJOR };
  if (a != null) {
    if (gkd.ellipsoidInvFlattening != null && gkd.ellipsoidInvFlattening !== 0) {
      ellipsoid.inverse_flattening = gkd.ellipsoidInvFlattening;
    } else if (gkd.ellipsoidSemiMinorAxis != null) {
      ellipsoid.semi_minor_axis = gkd.ellipsoidSemiMinorAxis;
    } else {
      ellipsoid.inverse_flattening = WGS84_INV_FLATTENING;
    }
  } else {
    ellipsoid.name = "WGS 84";
    ellipsoid.inverse_flattening = WGS84_INV_FLATTENING;
  }
  return {
    type: "GeodeticReferenceFrame",
    name: ellipsoid.name,
    ellipsoid,
    prime_meridian: { name: "Greenwich", longitude: 0.0 },
  };
}

/**
 * Emit the PROJJSON for a Cylindrical Equal Area projected CRS, with
 * `conversion.method.name = "cea"` so proj4 resolves it directly.
 */
function ceaProjJson(gkd: ProjGeoKeys): ProjectedCRS {
  const label = gkd.projectedCitation || gkd.citation || "Cylindrical Equal Area";
  return {
    type: "ProjectedCRS",
    $schema: "https://proj.org/schemas/v0.7/projjson.schema.json",
    name: label,
    base_crs: {
      type: "GeographicCRS",
      name: "Geographic",
      datum: ellipsoidJson(gkd),
      coordinate_system: {
        subtype: "ellipsoidal",
        axis: [
          { name: "Geodetic latitude", abbreviation: "Lat", direction: "north", unit: "degree" },
          { name: "Geodetic longitude", abbreviation: "Lon", direction: "east", unit: "degree" },
        ],
      },
    },
    conversion: {
      name: "cea",
      method: { name: "cea" },
      parameters: [
        { name: "Latitude of 1st standard parallel", value: num(gkd.projStdParallel1), unit: "degree" },
        { name: "Longitude of natural origin", value: num(gkd.projNatOriginLong), unit: "degree" },
        { name: "False easting", value: num(gkd.projFalseEasting), unit: "metre" },
        { name: "False northing", value: num(gkd.projFalseNorthing), unit: "metre" },
      ],
    },
    coordinate_system: {
      subtype: "Cartesian",
      axis: [
        { name: "Easting", abbreviation: "E", direction: "east", unit: "metre" },
        { name: "Northing", abbreviation: "N", direction: "north", unit: "metre" },
      ],
    },
  };
}

export type RescuedCrs = { def: ProjectionDefinition; label: string };

/**
 * Build a proj4-ready projection definition for a rescuable user-defined CRS, or
 * `null` if the projection isn't one we handle. Pure: no registration, no I/O.
 */
export function rescueCrsDef(gkd: ProjGeoKeys): RescuedCrs | null {
  if (gkd.projMethod !== CT_CYLINDRICAL_EQUAL_AREA) return null;
  const json = ceaProjJson(gkd);
  const def = parseWkt(json);
  // proj4's cea.js reads `lat_ts`; wkt-parser stores the standard parallel as
  // `lat1`. Copy it across so the projection isn't left with an undefined
  // standard parallel (which collapses every coordinate to NaN).
  if (def.lat_ts == null) def.lat_ts = def.lat1 ?? 0;
  return { def, label: json.name };
}

/** sentinel code → registered override. */
const overrides = new Map<number, RescuedCrs>();
/** proj4 def string → sentinel code, so an identical CRS reuses one code. */
const codeByKey = new Map<string, number>();

/**
 * If `tiff`'s projection is rescuable, seed `tiff._crs` with a sentinel code and
 * register a proj4 definition for it, so both the synchronous `crs` getter (read
 * by the metadata panel) and the COGLayer (via {@link rescuingEpsgResolver})
 * receive a working CRS. Returns whether a rescue was applied.
 */
export function applyCrsRescue(tiff: GeoTIFF): boolean {
  const rescued = rescueCrsDef(tiff.gkd);
  if (!rescued) return false;
  const key = JSON.stringify(rescued.def);
  let code = codeByKey.get(key);
  if (code === undefined) {
    code = SENTINEL_BASE + codeByKey.size;
    codeByKey.set(key, code);
    overrides.set(code, rescued);
  }
  // `_crs` is private on GeoTIFF and normally computed by the (throwing) getter;
  // seed the cache directly. Matches the metadata-override cast in load-geotiff.
  (tiff as unknown as { _crs?: number })._crs = code;
  return true;
}

/** Friendly CRS label for a rescued sentinel code, or `null` for other codes. */
export function crsOverrideLabel(code: number): string | null {
  return overrides.get(code)?.label ?? null;
}

/**
 * `epsgResolver` for COGLayer: returns our rescued definition for sentinel codes
 * and delegates to the library default (epsg.io lookup) for real EPSG codes.
 */
export const rescuingEpsgResolver: EpsgResolver = (code) => {
  const override = overrides.get(code);
  if (override) return Promise.resolve(override.def);
  return defaultEpsgResolver(code);
};
