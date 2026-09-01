import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "../EmptyState";

describe("EmptyState", () => {
  it("calls onSubmit when user pastes URL and clicks load", async () => {
    const onSubmit = vi.fn();
    render(<EmptyState onSubmit={onSubmit} />);
    await userEvent.type(
      screen.getByLabelText("cog-url"),
      "https://example.com/x.tif",
    );
    await userEvent.click(screen.getByRole("button", { name: /load/i }));
    expect(onSubmit).toHaveBeenCalledWith(["https://example.com/x.tif"]);
  });

  it("submits single-url example as one-element array", async () => {
    const onSubmit = vi.fn();
    render(<EmptyState onSubmit={onSubmit} />);
    // Pick the Sentinel-2 TCI single-band example by its visible title text
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /example/i }),
      "Sentinel-2 True Color (New York, 2024-08-14)",
    );
    expect(onSubmit).toHaveBeenCalledWith([
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2024/8/S2A_18TWL_20240814_0_L2A/TCI.tif",
    ]);
  });

  it("submits multi-url example as full array", async () => {
    const onSubmit = vi.fn();
    render(<EmptyState onSubmit={onSubmit} />);
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /example/i }),
      "Sentinel-2 Multi-Band (New York, 2024-08-14) — B04/B03/B02",
    );
    expect(onSubmit).toHaveBeenCalledWith([
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2024/8/S2A_18TWL_20240814_0_L2A/B04.tif",
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2024/8/S2A_18TWL_20240814_0_L2A/B03.tif",
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2024/8/S2A_18TWL_20240814_0_L2A/B02.tif",
    ]);
  });

  it("converts a dropped/uploaded file to a blob URL and submits", async () => {
    const onSubmit = vi.fn();
    if (!URL.createObjectURL) {
      URL.createObjectURL = () => "blob:test";
    }
    render(<EmptyState onSubmit={onSubmit} />);
    const file = new File(["fake-tiff-bytes"], "x.tif", { type: "image/tiff" });
    await userEvent.upload(screen.getByTestId("file-input"), file);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0][0]).toMatch(/^blob:/);
  });
});
