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
