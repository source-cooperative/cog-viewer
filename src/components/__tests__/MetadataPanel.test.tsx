import {
  Compression,
  Photometric,
  PlanarConfiguration,
  Predictor,
  SampleFormat,
  TiffTag,
} from "@cogeotiff/core";
import type { GeoTIFF } from "@developmentseed/geotiff";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MetadataPanel } from "../MetadataPanel";

const SAMPLE_GDAL_XML = `<GDALMetadata>
  <Item name="AREA_OR_POINT">Area</Item>
  <Item name="DESCRIPTION" sample="0">Red band</Item>
  <Item name="STATISTICS_MINIMUM" sample="0">0</Item>
  <Item name="STATISTICS_MAXIMUM" sample="0">10000</Item>
</GDALMetadata>`;

function makeStub(opts: { gdalXml?: string | null } = {}): GeoTIFF {
  const xml = "gdalXml" in opts ? opts.gdalXml ?? null : SAMPLE_GDAL_XML;
  return {
    image: {
      value: (tag: number) =>
        tag === TiffTag.GdalMetadata ? xml ?? undefined : undefined,
    },
    width: 1024,
    height: 1024,
    count: 1,
    tileWidth: 256,
    tileHeight: 256,
    nodata: -9999,
    crs: 3857,
    bbox: [-180, -85, 180, 85],
    cachedTags: {
      compression: Compression.Deflate,
      photometric: Photometric.MinIsBlack,
      bitsPerSample: new Uint16Array([16]),
      sampleFormat: [SampleFormat.Uint],
      predictor: Predictor.Horizontal,
      planarConfiguration: PlanarConfiguration.Contig,
      modelPixelScale: [10, 10, 0],
    },
    gkd: { citation: null, projectedCitation: null, geodeticCitation: null },
    offsets: [0],
    scales: [1],
    storedStats: null,
    overviews: [],
  } as unknown as GeoTIFF;
}

describe("MetadataPanel", () => {
  it("renders core sections with values from the GeoTIFF", () => {
    render(<MetadataPanel geotiff={makeStub()} />);
    // Sub-section headers live in <summary> elements; the body of CRS
    // also contains a <dt>CRS</dt> row label, so scope by element.
    const summaries = Array.from(document.querySelectorAll("summary")).map(
      (s) => s.textContent,
    );
    expect(summaries).toEqual(
      expect.arrayContaining([
        "Image",
        "CRS",
        expect.stringMatching(/Bands \(1\)/),
        "Raw GDAL_METADATA",
      ]),
    );
    // Concrete content from the stub.
    expect(screen.getByText("uint16")).toBeInTheDocument();
    expect(screen.getByText("EPSG:3857")).toBeInTheDocument();
    expect(screen.getByText(/1024 × 1024/)).toBeInTheDocument();
  });

  it("omits Raw XML and GDAL items sections when no metadata XML is present", () => {
    render(<MetadataPanel geotiff={makeStub({ gdalXml: null })} />);
    expect(screen.queryByText("Raw GDAL_METADATA")).not.toBeInTheDocument();
    expect(screen.queryByText(/GDAL items/)).not.toBeInTheDocument();
    // But Image / CRS still render.
    expect(screen.getByText("Image")).toBeInTheDocument();
  });

  it("Copy button writes the raw XML to the clipboard", async () => {
    const writes: string[] = [];
    Object.assign(navigator, {
      clipboard: { writeText: async (s: string) => void writes.push(s) },
    });
    render(<MetadataPanel geotiff={makeStub()} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writes).toEqual([SAMPLE_GDAL_XML]);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});
