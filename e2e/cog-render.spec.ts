import { expect, test } from "@playwright/test";

/**
 * Build a minimal valid Cloud-Optimized GeoTIFF binary in memory.
 *
 * Layout:
 *   [0..7]    TIFF header (little-endian, magic 42, IFD offset)
 *   [8..4103] 64×64 single-band uint8 tile (4096 bytes of zeros)
 *   [4104..]  IFD (14 entries) + extended doubles/shorts for GeoTIFF tags
 *
 * The file declares EPSG:4326 (WGS84) via GeoKeyDirectory and covers
 * the whole globe [-180,-90 → 180,90] so isValidGeographicBounds returns
 * true and onGeoTIFFLoad sets extentValid=true.
 */
function createTestCog(): Buffer {
  const W = 64;
  const H = 64;
  const TILE_BYTES = W * H; // 4096

  const TILE_OFFSET = 8;
  const IFD_OFFSET = TILE_OFFSET + TILE_BYTES; // 4104
  const N_ENTRIES = 14;
  const IFD_BLOCK = 2 + N_ENTRIES * 12 + 4; // 174
  const DATA_OFFSET = IFD_OFFSET + IFD_BLOCK; // 4278

  // Extended data offsets
  const MPS_OFF = DATA_OFFSET;       // ModelPixelScale: 3 doubles = 24 bytes
  const MTP_OFF = MPS_OFF + 24;     // ModelTiepoint:  6 doubles = 48 bytes
  const GKD_OFF = MTP_OFF + 48;     // GeoKeyDirectory: 16 uint16 = 32 bytes
  const FILE_SIZE = GKD_OFF + 32;   // ~4382 bytes

  const buf = Buffer.alloc(FILE_SIZE, 0);

  // TIFF header
  buf.writeUInt16LE(0x4949, 0);       // 'II' — little-endian
  buf.writeUInt16LE(42, 2);            // TIFF magic
  buf.writeUInt32LE(IFD_OFFSET, 4);   // offset to first IFD

  // Tile data is already zeroed (black image).

  // IFD — entries must be in ascending tag order.
  let p = IFD_OFFSET;
  buf.writeUInt16LE(N_ENTRIES, p);
  p += 2;

  const entry = (tag: number, type: number, count: number, valOrOff: number) => {
    buf.writeUInt16LE(tag, p);
    buf.writeUInt16LE(type, p + 2);
    buf.writeUInt32LE(count, p + 4);
    buf.writeUInt32LE(valOrOff, p + 8);
    p += 12;
  };

  // type 3 = SHORT (uint16), type 4 = LONG (uint32), type 12 = DOUBLE (float64)
  entry(256, 4, 1, W);             // ImageWidth
  entry(257, 4, 1, H);             // ImageLength
  entry(258, 3, 1, 8);             // BitsPerSample = 8
  entry(259, 3, 1, 1);             // Compression = None
  entry(262, 3, 1, 1);             // PhotometricInterpretation = MinIsBlack
  entry(277, 3, 1, 1);             // SamplesPerPixel = 1
  entry(284, 3, 1, 1);             // PlanarConfiguration = Contig
  entry(322, 3, 1, W);             // TileWidth
  entry(323, 3, 1, H);             // TileLength
  entry(324, 4, 1, TILE_OFFSET);   // TileOffsets (single tile at offset 8)
  entry(325, 4, 1, TILE_BYTES);    // TileByteCounts
  entry(33550, 12, 3, MPS_OFF);    // ModelPixelScaleTag
  entry(33922, 12, 6, MTP_OFF);    // ModelTiepointTag
  entry(34735, 3, 16, GKD_OFF);    // GeoKeyDirectoryTag (34735, not 34736=GeoDoubleParams)

  buf.writeUInt32LE(0, p); // next IFD = none

  // ModelPixelScale: [scaleX, scaleY, scaleZ]
  // 64×64 image spanning [-180,-90 → 180,90] → 5.625 deg/px, 2.8125 deg/px
  buf.writeDoubleLE(360 / W, MPS_OFF);
  buf.writeDoubleLE(180 / H, MPS_OFF + 8);
  buf.writeDoubleLE(0, MPS_OFF + 16);

  // ModelTiepoint: [I, J, K, X, Y, Z]  pixel (0,0) → lon -180, lat 90
  buf.writeDoubleLE(0, MTP_OFF);
  buf.writeDoubleLE(0, MTP_OFF + 8);
  buf.writeDoubleLE(0, MTP_OFF + 16);
  buf.writeDoubleLE(-180.0, MTP_OFF + 24);
  buf.writeDoubleLE(90.0, MTP_OFF + 32);
  buf.writeDoubleLE(0, MTP_OFF + 40);

  // GeoKeyDirectory: header (4 shorts) + 3 keys (4 shorts each) = 16 shorts
  const geoKeys = [
    1, 1, 0, 3,       // KeyDirectoryVersion 1.1.0, NumberOfKeys = 3
    1024, 0, 1, 2,    // GTModelTypeGeoKey = 2 (Geographic)
    1025, 0, 1, 1,    // GTRasterTypeGeoKey = 1 (PixelIsArea)
    2048, 0, 1, 4326, // GeographicTypeGeoKey = 4326 (WGS 84)
  ];
  for (let i = 0; i < geoKeys.length; i++) {
    buf.writeUInt16LE(geoKeys[i], GKD_OFF + i * 2);
  }

  return buf;
}

/**
 * Regression test for https://github.com/source-cooperative/cog-viewer/issues/35
 *
 * The bug: commit 26ea9f0 initialised `extentValid` to `false` and only set it
 * `true` inside `onGeoTIFFLoad`. But `onGeoTIFFLoad` is called by the deck.gl
 * layer's lifecycle — a lifecycle that only runs when the layer is in the
 * deck.gl overlay stack. `selectOverlayLayers` gates on `extentValid`, so the
 * layer was never added to the stack, `onGeoTIFFLoad` was never called, and
 * tiles were never displayed.
 *
 * Detection strategy: for a 1-band COG, the app auto-sets `mode="single"` once
 * `bandCount` is known (set inside `onGeoTIFFLoad`). That makes the single-band
 * selector `select[aria-label="band"]` appear. If `onGeoTIFFLoad` is never
 * called the selector never appears and the test times out.
 */
test("COG tiles render for a valid 1-band WGS84 COG (regression #35)", async ({ page }) => {
  const cogBinary = createTestCog();

  // Serve the test fixture at a predictable URL with full Range-request
  // support — the @chunkd/source-http layer makes multiple partial fetches
  // when reading the TIFF header and tile data.
  const FIXTURE_URL = "http://localhost:5173/e2e-test-fixture.tif";
  await page.route(FIXTURE_URL, async (route) => {
    const rangeHeader = route.request().headers()["range"];
    if (rangeHeader) {
      const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      const start = m ? parseInt(m[1], 10) : 0;
      const reqEnd = m && m[2] ? parseInt(m[2], 10) : cogBinary.length - 1;
      const end = Math.min(reqEnd, cogBinary.length - 1);
      const chunk = cogBinary.subarray(start, end + 1);
      await route.fulfill({
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${cogBinary.length}`,
          "Content-Length": String(chunk.length),
          "Accept-Ranges": "bytes",
          "Content-Type": "application/octet-stream",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "Content-Range",
        },
        body: Buffer.from(chunk),
      });
    } else {
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Length": String(cogBinary.length),
          "Accept-Ranges": "bytes",
          "Content-Type": "application/octet-stream",
          "Access-Control-Allow-Origin": "*",
        },
        body: cogBinary,
      });
    }
  });

  // Capture app console output so CI failures have useful diagnostics.
  const consoleLogs: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    }
  });

  // panel=open ensures the controls panel is open so the band selector is
  // not hidden inside a closed <details> element.
  await page.goto(`/?url=${encodeURIComponent(FIXTURE_URL)}&panel=open`);

  // Wait for the app to reach a terminal state: either the single-band selector
  // appears (success) or an error toast appears (failure with a useful message).
  //
  // The selector appears after:
  //   1. loadGeoTIFF opens the file successfully
  //   2. COGLayer._parseGeoTIFF resolves the CRS and calls onGeoTIFFLoad
  //   3. onGeoTIFFLoad sets bandCount=1
  //   4. The auto-mode effect fires and sets state.mode="single"
  //   5. React re-renders with the single-band UI
  //
  // If extentValid is stuck at false (the #35 bug), step 2 never happens
  // because the COGLayer never enters the deck.gl overlay stack.
  await page
    .waitForFunction(
      () =>
        document.querySelector('select[aria-label="band"]') !== null ||
        document.querySelector('[role="alert"]') !== null,
      { timeout: 20_000 },
    )
    .catch(() => {
      const logSummary = consoleLogs.length
        ? `\nConsole output:\n${consoleLogs.join("\n")}`
        : "";
      throw new Error(
        `Timed out after 20 s waiting for band selector or error toast. ` +
          `The COG may not have loaded (extentValid stuck at false = regression #35, ` +
          `or loadGeoTIFF failed).${logSummary}`,
      );
    });

  const errorAlert = page.locator('[role="alert"]');
  if (await errorAlert.isVisible()) {
    const msg = (await errorAlert.textContent()) ?? "(no text)";
    throw new Error(
      `App showed an error toast instead of rendering the COG: "${msg}"` +
        (consoleLogs.length
          ? `\nConsole output:\n${consoleLogs.join("\n")}`
          : ""),
    );
  }

  await expect(page.locator('select[aria-label="band"]')).toBeVisible();
});
