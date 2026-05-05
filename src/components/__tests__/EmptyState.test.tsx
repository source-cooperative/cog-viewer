import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "../EmptyState";

describe("EmptyState", () => {
  it("calls onSubmit when user pastes URL and clicks load", async () => {
    const onSubmit = vi.fn();
    render(<EmptyState onSubmit={onSubmit} />);
    await userEvent.type(
      screen.getByPlaceholderText(/cog url/i),
      "https://example.com/x.tif",
    );
    await userEvent.click(screen.getByRole("button", { name: /load/i }));
    expect(onSubmit).toHaveBeenCalledWith("https://example.com/x.tif");
  });

  it("submits when user picks an example", async () => {
    const onSubmit = vi.fn();
    render(<EmptyState onSubmit={onSubmit} />);
    const exampleUrl =
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2026/1/S2B_18TWL_20260101_0_L2A/TCI.tif";
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /example/i }),
      exampleUrl,
    );
    expect(onSubmit).toHaveBeenCalledWith(exampleUrl);
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
    expect(onSubmit.mock.calls[0][0]).toMatch(/^blob:/);
  });
});
