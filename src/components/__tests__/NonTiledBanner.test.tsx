import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NonTiledBanner } from "../NonTiledBanner";

describe("NonTiledBanner", () => {
  it("renders nothing when status is null", () => {
    const { container } = render(
      <NonTiledBanner status={null} onConfirm={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows auto banner with single size when sizes are close", () => {
    render(
      <NonTiledBanner
        status={{
          kind: "auto",
          decodedBytes: 12 * 1024 * 1024,
          diskBytes: 11 * 1024 * 1024,
        }}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/not a cloud optimized/i);
    expect(screen.getByRole("status")).toHaveTextContent(/12 MB/);
    // Single size shown — the ratio is < 1.5.
    expect(screen.queryByText(/decoded/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load anyway/i })).not.toBeInTheDocument();
  });

  it("shows both sizes when they differ meaningfully", () => {
    render(
      <NonTiledBanner
        status={{
          kind: "auto",
          decodedBytes: 600 * 1024 * 1024,
          diskBytes: 30 * 1024 * 1024,
        }}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/Download:\s*30 MB/);
    expect(screen.getByRole("status")).toHaveTextContent(/Decoded:\s*600 MB/);
  });

  it("shows Load anyway button when status is 'confirm'", () => {
    const onConfirm = vi.fn();
    render(
      <NonTiledBanner
        status={{
          kind: "confirm",
          decodedBytes: 200 * 1024 * 1024,
          diskBytes: 200 * 1024 * 1024,
        }}
        onConfirm={onConfirm}
      />,
    );
    const btn = screen.getByRole("button", { name: /load anyway/i });
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not show the button after confirmed", () => {
    render(
      <NonTiledBanner
        status={{
          kind: "confirmed",
          decodedBytes: 200 * 1024 * 1024,
          diskBytes: 200 * 1024 * 1024,
        }}
        onConfirm={() => {}}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /load anyway/i }),
    ).not.toBeInTheDocument();
  });

  it("includes the gdal_translate conversion hint", () => {
    render(
      <NonTiledBanner
        status={{
          kind: "auto",
          decodedBytes: 1024,
          diskBytes: 1024,
        }}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/gdal_translate -of COG/);
  });
});
