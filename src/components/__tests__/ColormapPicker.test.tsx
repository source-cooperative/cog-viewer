import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColormapPicker, type ColormapOption } from "../ColormapPicker";

const OPTIONS: ColormapOption[] = [
  { name: "viridis", label: "Viridis", rowIndex: 0 },
  { name: "magma", label: "Magma", rowIndex: 1 },
  { name: "magma_r", label: "Magma (reversed)", rowIndex: 1, reversed: true },
];

describe("ColormapPicker", () => {
  it("renders the preview when value matches a known option", () => {
    render(
      <ColormapPicker
        colormapsPngUrl="/colormaps.png"
        rowCount={OPTIONS.length}
        value="viridis"
        options={OPTIONS}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("colormap-preview")).toBeInTheDocument();
  });

  it("does not render the preview when value is unknown", () => {
    render(
      <ColormapPicker
        colormapsPngUrl="/colormaps.png"
        rowCount={OPTIONS.length}
        value="not-a-real-name"
        options={OPTIONS}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("colormap-preview")).not.toBeInTheDocument();
  });
});
