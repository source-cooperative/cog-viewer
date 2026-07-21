# Draft PR — `@developmentseed/geotiff`: support Cylindrical Equal Area (ProjCoordTrans 28)

**Repo:** https://github.com/developmentseed/deck.gl-raster (package `packages/geotiff`)
**File:** `src/crs.ts` (compiled to `dist/crs.js`)

## Title
feat(geotiff): emit a conversion for Cylindrical Equal Area (GeoTIFF CT code 28)

## Problem
`_buildConversion()` implements GeoTIFF `ProjCoordTransGeoKey` (3075) codes 1–27,
then throws for anything else:

```
Unsupported coordinate transformation type: 28
```

Code **28 = `CT_CylindricalEqualArea`** is written by GDAL/libgeotiff for World /
Lambert Cylindrical Equal Area COGs (ESRI:54034, the EASE-Grid family). It sits
just above the OGC GeoTIFF 1.1 list (which stops at 27), so files with valid,
common projections fail to open: accessing `geotiff.crs` throws, which crashes
any consumer that reads it (e.g. deck.gl-geotiff's `COGLayer._parseGeoTIFF`, or a
synchronous metadata reader).

## Change
Add the constant and a `case` mirroring the existing equal-area entries. Uses the
EPSG method name **"Lambert Cylindrical Equal Area"** (EPSG method 9835) with its
standard parameters.

```diff
 const CT_NEW_ZEALAND_MAP_GRID = 26;
 const CT_TRANSVERSE_MERCATOR_SOUTH_ORIENTED = 27;
+const CT_CYLINDRICAL_EQUAL_AREA = 28;
```

```diff
         case CT_NEW_ZEALAND_MAP_GRID: {
             // ...unchanged...
         }
+        case CT_CYLINDRICAL_EQUAL_AREA: {
+            const name = "Lambert Cylindrical Equal Area";
+            return {
+                name,
+                method: { name },
+                parameters: [
+                    angular(
+                        "Latitude of 1st standard parallel",
+                        gkd.projStdParallel1 ?? gkd.projNatOriginLat,
+                    ),
+                    angular("Longitude of natural origin", gkd.projNatOriginLong),
+                    linear("False easting", gkd.projFalseEasting),
+                    linear("False northing", gkd.projFalseNorthing),
+                ],
+            };
+        }
         default:
             throw new Error(`Unsupported coordinate transformation type: ${ct}`);
```

## Note on the downstream proj4 path
Emitting the conversion is necessary but not sufficient for rendering: proj4 only
resolves the projection name `cea`, and `wkt-parser` maps the standard parallel to
`lat1` while proj4's `cea.js` reads `lat_ts`. See the companion proj4js PR draft
(`proj4-cylindrical-equal-area.md`) which adds the name aliases and a `lat1`
fallback so an emitted "Lambert Cylindrical Equal Area" CRS reprojects correctly.

## Test
Add a fixture with `projMethod = 28` and assert `crsFromGeoKeys` returns a
`ProjectedCRS` whose `conversion.method.name === "Lambert Cylindrical Equal Area"`
and whose parameters carry the standard parallel / central meridian / false
easting / false northing from the geo keys.
