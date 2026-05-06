export type Mode = "rgb" | "single";

export type Basemap = "auto" | "light" | "dark" | "satellite" | "off";

export type PanelState = "open" | "closed";

export type Sigmoidal = { contrast: number; bias: number };

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
  /** Sigmoidal contrast (rio-color formula). null = off. */
  sigmoidal: Sigmoidal | null;
  /** Draw the COG below the basemap's label layers (default true). */
  labelsAbove: boolean;
};

export type CogStateUpdate = Partial<
  Omit<CogState, "opacity" | "gamma" | "labelsAbove">
> & {
  opacity?: number;
  gamma?: number;
  labelsAbove?: boolean;
};
