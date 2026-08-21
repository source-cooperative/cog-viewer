import { normalizeUrl } from "../normalize-url";

describe("normalizeUrl", () => {
  it("rewrites source.coop web UI URLs to the data endpoint", () => {
    expect(
      normalizeUrl(
        "https://source.coop/rebalance-earth/ea-dem/DTM/NT80ne_DTM_1m.tif",
      ),
    ).toBe(
      "https://data.source.coop/rebalance-earth/ea-dem/DTM/NT80ne_DTM_1m.tif",
    );
  });

  it("preserves the full path after the hostname", () => {
    expect(normalizeUrl("https://source.coop/org/repo/subdir/file.tif")).toBe(
      "https://data.source.coop/org/repo/subdir/file.tif",
    );
  });

  it("leaves data.source.coop URLs unchanged", () => {
    const url = "https://data.source.coop/org/repo/file.tif";
    expect(normalizeUrl(url)).toBe(url);
  });

  it("leaves unrelated URLs unchanged", () => {
    const url = "https://example.com/data/cog.tif";
    expect(normalizeUrl(url)).toBe(url);
  });

  it("leaves S3 URLs unchanged", () => {
    const url = "https://mybucket.s3.amazonaws.com/cog.tif";
    expect(normalizeUrl(url)).toBe(url);
  });
});
