/**
 * Colormap dropdown + sprite-strip preview of the active selection.
 *
 * The sprite (`colormapsPngUrl`) is a vertical strip with one row per
 * colormap, in the order given by `COLORMAP_INDEX`. We render the chosen
 * row as a background image, sized so a single row fills the preview's
 * height. When `reversed` is true on the matching option, the preview is
 * flipped horizontally to match what the shader emits.
 */

export type ColormapOption = {
  name: string;
  label: string;
  rowIndex: number;
  reversed?: boolean;
};

export type ColormapPickerProps = {
  colormapsPngUrl: string;
  rowCount: number;
  /** Active colormap name. Matches `option.name`. */
  value: string;
  options: ColormapOption[];
  onChange: (next: string) => void;
};

export function ColormapPicker({
  colormapsPngUrl,
  rowCount,
  value,
  options,
  onChange,
}: ColormapPickerProps) {
  const active = options.find((o) => o.name === value);

  // Each sprite row is (100 / rowCount)% of the strip's height; positioning
  // by `background-position-y` requires a percent expressed against the
  // *unscaled* height. The CSS `background-size: 100% auto` keeps the
  // sprite's aspect ratio, so we set the height explicitly and use
  // `background-size: 100% Nx` where N = rowCount * preview-height.
  const previewHeight = 14;
  const stripHeight = previewHeight * rowCount;

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <select
        aria-label="colormap"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.name} value={o.name}>
            {o.label}
          </option>
        ))}
      </select>
      {active && (
        <div
          aria-hidden
          data-testid="colormap-preview"
          className="colormap-preview"
          style={{
            height: previewHeight,
            borderRadius: 2,
            backgroundImage: `url(${colormapsPngUrl})`,
            backgroundRepeat: "no-repeat",
            backgroundSize: `100% ${stripHeight}px`,
            backgroundPosition: `0 ${-active.rowIndex * previewHeight}px`,
            transform: active.reversed ? "scaleX(-1)" : undefined,
            // Smooth gradient lookup — the sprite is 256 px wide and the
            // browser would otherwise nearest-sample the upscaled row.
            imageRendering: "auto",
          }}
        />
      )}
    </div>
  );
}
