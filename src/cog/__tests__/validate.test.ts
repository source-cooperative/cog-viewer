import { describe, expect, it } from "vitest";
import { validateCog } from "../validate";

describe("validateCog", () => {
  it("flags a striped (non-tiled) TIFF as an error", () => {
    const result = validateCog({ image: { isTiled: () => false }, overviews: [] });
    expect(result?.level).toBe("error");
    expect(result?.message).toMatch(/strip/i);
  });

  it("warns when a tiled COG has no overviews", () => {
    const result = validateCog({ image: { isTiled: () => true }, overviews: [] });
    expect(result?.level).toBe("warning");
    expect(result?.message).toMatch(/overview/i);
  });

  it("returns null for a tiled COG that has overviews", () => {
    const result = validateCog({
      image: { isTiled: () => true },
      overviews: [{}, {}],
    });
    expect(result).toBeNull();
  });
});
