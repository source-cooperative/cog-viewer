export type Mode = "rgb" | "single";

export type Basemap = "auto" | "light" | "dark" | "satellite" | "off";

export type PanelState = "open" | "closed";

/** Curve applied to the rescaled [0, 1] value before gamma / colormap.
 * "log" expands the low-value range (useful for skewed data with most
 * variation near zero); "sqrt" is a gentler version. */
export type Stretch = "linear" | "log" | "sqrt";

export type CogState = {
  url: string | null;
  mode: Mode | null;
  bands: number[] | null;
  rescale: [number, number][] | null;
  colormap: string | null;
  nodata: number | "off" | null;
  opacity: number;
  colorspace: string | null;
  basemap: Basemap;
  panel: PanelState;
  /** Power-law gamma correction (1.0 = off). */
  gamma: number;
  /** Draw the COG below the basemap's label layers (default true). */
  labelsAbove: boolean;
  /** Curve applied to rescaled values. "linear" by default. */
  stretch: Stretch;
};

export type CogStateUpdate = Partial<
  Omit<CogState, "opacity" | "gamma" | "labelsAbove">
> & {
  opacity?: number;
  gamma?: number;
  labelsAbove?: boolean;
};
