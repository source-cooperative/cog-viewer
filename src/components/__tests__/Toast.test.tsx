import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toast, humanizeError } from "../Toast";

describe("humanizeError", () => {
  it("maps a 'Tiff is not tiled' error to the non-COG message", () => {
    const msg = humanizeError(new Error("Tiff is not tiled"));
    expect(msg).toMatch(/strip|not a cloud optimized/i);
  });

  it("maps a tile decode / unsupported-compression error to a friendly message", () => {
    const msg = humanizeError(new Error("unsupported compression 34887"));
    expect(msg).toMatch(/decode|compression/i);
  });

  it("maps a bare browser 'Failed to fetch' to the CORS guidance message", () => {
    const msg = humanizeError(new Error("Failed to fetch"));
    expect(msg).toMatch(/cors/i);
  });

  it("does NOT map a @chunkd/source-http wrapped error ('Failed to fetch: <url>') to CORS guidance", () => {
    // @chunkd/source-http wraps ALL errors as "Failed to fetch: <url>" — this
    // pattern should not trigger CORS guidance since the underlying cause may
    // be unrelated to CORS (rate limiting, server error, etc.).
    const msg = humanizeError(
      new Error("Failed to fetch: https://example.com/data.tif"),
    );
    expect(msg).not.toMatch(/cors/i);
  });

  it("does NOT map a geotiff insufficient-bytes error ('Failed to fetch bytes') to CORS guidance", () => {
    const msg = humanizeError(
      new Error("Failed to fetch bytes from offset:0 wanted:32768 got:1024"),
    );
    expect(msg).not.toMatch(/cors/i);
  });

  it("default (cog) context uses 'Could not load the COG' fallback for unrecognised errors", () => {
    const msg = humanizeError(new Error("something went wrong xyz42"));
    expect(msg).toMatch(/could not load the cog/i);
  });

  it("tile context uses tile-specific fallback and never says 'Could not load the COG'", () => {
    const msg = humanizeError(new Error("something went wrong xyz42"), "tile");
    expect(msg).not.toMatch(/could not load the cog/i);
  });

  it("tile context gives a clean message for @chunkd/source-http wrapped errors", () => {
    const msg = humanizeError(
      new Error("Failed to fetch: https://data.source.coop/file.tif"),
      "tile",
    );
    expect(msg).not.toMatch(/could not load the cog/i);
    expect(msg).not.toMatch(/cors/i);
    expect(msg).toMatch(/tile/i);
  });
});

describe("Toast", () => {
  it("renders nothing when message is null", () => {
    const { container } = render(<Toast message={null} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the message as an alert by default", () => {
    render(<Toast message="boom" onDismiss={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });

  it("renders a warning-level toast with a distinct amber background", () => {
    render(<Toast message="heads up" level="warning" onDismiss={() => {}} />);
    const el = screen.getByRole("status");
    expect(el).toHaveTextContent("heads up");
    expect(el).toHaveStyle({ background: "#7a5a1a" });
  });
});
