export type Mode = "rgb" | "single";

export type Basemap = "auto" | "light" | "dark" | "satellite" | "off";

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
};

export type CogStateUpdate = Partial<Omit<CogState, "opacity">> & {
  opacity?: number;
};
