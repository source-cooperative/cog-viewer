import type { Basemap } from "../state/types";

type Props = {
  value: Basemap;
  onChange: (b: Basemap) => void;
};

const OPTIONS: { value: Basemap; label: string }[] = [
  { value: "auto", label: "Auto (system)" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "satellite", label: "Satellite" },
  { value: "off", label: "None" },
];

export function BasemapPicker({ value, onChange }: Props) {
  return (
    <label
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        background: "rgba(255,255,255,0.92)",
        padding: "6px 8px",
        borderRadius: 6,
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        zIndex: 5,
        display: "flex",
        gap: 6,
        alignItems: "center",
        fontSize: 12,
      }}
    >
      <span>Basemap</span>
      <select
        aria-label="basemap"
        value={value}
        onChange={(e) => onChange(e.target.value as Basemap)}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
