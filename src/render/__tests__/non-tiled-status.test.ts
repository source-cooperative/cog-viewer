import { describe, expect, it } from "vitest";
import {
  initialStatus,
  SIZE_GATE_BYTES,
  shouldRender,
  statusFromSizes,
} from "../non-tiled-status";

describe("statusFromSizes", () => {
  it("returns 'auto' under the gate", () => {
    const status = statusFromSizes({ decodedBytes: 10_000, diskBytes: 5_000 });
    expect(status).toEqual({
      kind: "auto",
      decodedBytes: 10_000,
      diskBytes: 5_000,
    });
  });

  it("returns 'confirm' when max exceeds the gate", () => {
    const status = statusFromSizes({
      decodedBytes: SIZE_GATE_BYTES + 1,
      diskBytes: 1,
    });
    expect(status.kind).toBe("confirm");
  });

  it("returns 'confirm' when disk exceeds gate even if decoded is small", () => {
    const status = statusFromSizes({
      decodedBytes: 1,
      diskBytes: SIZE_GATE_BYTES + 1,
    });
    expect(status.kind).toBe("confirm");
  });

  it("returns 'auto' at exactly the gate (boundary pinned to >)", () => {
    const status = statusFromSizes({
      decodedBytes: SIZE_GATE_BYTES,
      diskBytes: 0,
    });
    expect(status.kind).toBe("auto");
  });
});

describe("shouldRender", () => {
  it("renders for auto and confirmed; not for confirm or null", () => {
    expect(shouldRender(null)).toBe(false);
    expect(shouldRender({ kind: "auto", decodedBytes: 1, diskBytes: 1 })).toBe(true);
    expect(
      shouldRender({ kind: "confirm", decodedBytes: 1, diskBytes: 1 }),
    ).toBe(false);
    expect(
      shouldRender({ kind: "confirmed", decodedBytes: 1, diskBytes: 1 }),
    ).toBe(true);
  });
});

describe("initialStatus", () => {
  it("is null", () => {
    expect(initialStatus).toBeNull();
  });
});
