import { describe, expect, it } from "vitest";
import { formatBytes } from "../format-bytes";

describe("formatBytes", () => {
  it("formats bytes under 1 KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats KB / MB / GB with one decimal when < 10, none when >= 10", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 9.5)).toBe("9.5 KB");
    expect(formatBytes(1024 * 12)).toBe("12 KB");
    expect(formatBytes(1024 * 1024 * 64)).toBe("64 MB");
    expect(formatBytes(1024 * 1024 * 1024 * 1.5)).toBe("1.5 GB");
  });

  it("clamps to 'TB' for absurd values", () => {
    expect(formatBytes(1024 ** 4 * 3)).toBe("3.0 TB");
  });
});
