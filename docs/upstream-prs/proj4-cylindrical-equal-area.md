# Draft PR — proj4js: make Cylindrical Equal Area resolvable from WKT / PROJJSON

**Repo:** https://github.com/proj4js/proj4js (observed on v2.20.8)
**File:** `lib/projections/cea.js`

## Title
fix(cea): resolve Cylindrical Equal Area by EPSG method name and honor `lat1`

## Problem
proj4 ships the Cylindrical Equal Area math (`lib/projections/cea.js`) but it is
effectively unreachable from a WKT / PROJJSON source:

1. **Name matching.** `cea.js` registers only `names = ['cea']`. A CRS whose
   projection method comes from EPSG/WKT is `"Lambert Cylindrical Equal Area"`
   (or `"Cylindrical Equal Area"`), which normalizes (see
   `getNormalizedProjName`, lowercased + `[-()\s]+`→`_`) to
   `lambert_cylindrical_equal_area` — not `cea` — so `Proj.js` throws
   `Could not get projection name from: …`.
2. **Standard parallel.** `cea.js`'s `init()` reads `this.lat_ts`, but
   `wkt-parser` stores the "Latitude of 1st standard parallel" parameter as
   `lat1`. With `lat_ts` undefined, `msfnz(e, sin(undefined), …)` makes `k0`
   `NaN`, so every forward/inverse coordinate becomes `NaN`.

Net effect: EASE-Grid / World Cylindrical Equal Area layers (EPSG:6933, 6931,
6932, ESRI:54034, …) either throw on name lookup or silently produce `NaN`.

## Change
```diff
 export function init() {
-  // no-op
+  // wkt-parser stores the standard parallel as `lat1`; proj4's cea math reads
+  // `lat_ts`. Fall back so WKT/PROJJSON-sourced definitions aren't left with an
+  // undefined standard parallel (which collapses every coordinate to NaN).
+  if (this.lat_ts === undefined) {
+    this.lat_ts = this.lat1 !== undefined ? this.lat1 : 0;
+  }
   if (!this.sphere) {
     this.k0 = msfnz(this.e, Math.sin(this.lat_ts), Math.cos(this.lat_ts));
   }
 }
```

```diff
-export var names = ['cea'];
+export var names = [
+  'cea',
+  'Cylindrical_Equal_Area',
+  'Lambert_Cylindrical_Equal_Area',
+];
```

(Names are lowercased on registration and the lookup normalizes whitespace/case,
so `"Lambert Cylindrical Equal Area"` from WKT/PROJJSON now resolves.)

## Test
- `proj4('+proj=cea +lat_ts=30 +lon_0=0 +datum=WGS84 +units=m', 'EPSG:4326')`
  round-trips a point (regression guard on the `lat1`/`lat_ts` fallback — the
  proj-string path already sets `lat_ts`, but the WKT path should now match it).
- A PROJJSON `ProjectedCRS` with `conversion.method.name = "Lambert Cylindrical
  Equal Area"` and a "Latitude of 1st standard parallel" parameter reprojects to
  finite coordinates (previously threw / produced `NaN`).

## Companion
Pairs with the `@developmentseed/geotiff` draft
(`geotiff-cylindrical-equal-area.md`), which makes that library *emit* a
`"Lambert Cylindrical Equal Area"` conversion for GeoTIFF CT code 28. With both
merged, cog-viewer's `src/cog/crs-rescue.ts` shim can be removed.
