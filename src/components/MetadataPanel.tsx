import type { GeoTIFF } from "@developmentseed/geotiff";
import { useMemo, useState } from "react";
import {
  prettyPrintGdalXml,
  summarizeGeoTIFF,
  type BandSummary,
  type GdalItem,
  type MetadataSummary,
} from "../cog/metadata";

type Props = { geotiff: GeoTIFF };

/** Renders the per-COG metadata block. Pure: derives everything from the
 * already-loaded GeoTIFF. */
export function MetadataPanel({ geotiff }: Props) {
  const summary = useMemo<MetadataSummary>(
    () => summarizeGeoTIFF(geotiff),
    [geotiff],
  );
  return (
    <div className="meta-root">
      <Subsection title="Image" defaultOpen>
        <ImageRows s={summary} />
      </Subsection>
      <Subsection title="CRS">
        <CrsRows s={summary} />
      </Subsection>
      <Subsection title={`Overviews (${summary.overviews.length})`}>
        <Overviews s={summary} />
      </Subsection>
      <Subsection title={`Bands (${summary.bands.length})`}>
        <Bands bands={summary.bands} />
      </Subsection>
      {summary.gdalItems.length > 0 && (
        <Subsection title={`GDAL items (${summary.gdalItems.length})`}>
          <Items items={summary.gdalItems} />
        </Subsection>
      )}
      {summary.rawGdalXml !== null && (
        <Subsection title="Raw GDAL_METADATA">
          <RawXml raw={summary.rawGdalXml} />
        </Subsection>
      )}
    </div>
  );
}

function Subsection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="meta-sub" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="meta-sub-body">{children}</div>
    </details>
  );
}

/** Compact two-column key/value table. The value column is monospaced so
 * numbers / codes line up. */
function KV({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="meta-kv">
      {rows.map(([k, v]) => (
        <div key={k} className="meta-kv-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ImageRows({ s }: { s: MetadataSummary }) {
  const im = s.image;
  const compression =
    im.predictor !== null ? `${im.compression} (${im.predictor})` : im.compression;
  return (
    <KV
      rows={[
        ["Size", `${im.width} × ${im.height}`],
        ["Bands", String(im.bandCount)],
        ["Type", im.dtype],
        ["Compression", compression],
        ["Photometric", im.photometric],
        ["Tiles", `${im.tileWidth} × ${im.tileHeight}, ${im.planarConfig}`],
        ["Nodata", im.nodata === null ? "—" : String(im.nodata)],
      ]}
    />
  );
}

function CrsRows({ s }: { s: MetadataSummary }) {
  const { label, citation, bbox, pixelScale } = s.crs;
  const rows: Array<[string, React.ReactNode]> = [["CRS", label]];
  if (citation) rows.push(["Citation", citation]);
  rows.push(["BBox", fmtBbox(bbox)]);
  if (pixelScale) rows.push(["Pixel scale", `${pixelScale[0]} × ${pixelScale[1]}`]);
  return <KV rows={rows} />;
}

function fmtBbox(b: [number, number, number, number]): string {
  return `[${b.map(fmtCoord).join(", ")}]`;
}
function fmtCoord(n: number): string {
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  if (abs >= 1000) return n.toFixed(0);
  if (abs >= 1) return n.toFixed(2);
  return n.toPrecision(4);
}

function Overviews({ s }: { s: MetadataSummary }) {
  if (s.overviews.length === 0) return <span className="meta-muted">none</span>;
  return (
    <ul className="meta-list mono">
      {s.overviews.map((o, i) => (
        <li key={i}>
          {o.width} × {o.height}{" "}
          <span className="meta-muted">
            ({o.tileCount.x} × {o.tileCount.y} tiles)
          </span>
        </li>
      ))}
    </ul>
  );
}

function Bands({ bands }: { bands: BandSummary[] }) {
  return (
    <ul className="meta-list mono">
      {bands.map((b) => (
        <li key={b.index}>
          <strong>{b.index}</strong>
          {b.name ? <> — {b.name}</> : null}
          <BandDetails band={b} />
        </li>
      ))}
    </ul>
  );
}

function BandDetails({ band }: { band: BandSummary }) {
  const parts: string[] = [];
  if (band.stats) {
    const { min, max, mean, std, validPercent } = band.stats;
    if (min !== null && max !== null) parts.push(`range [${fmtNum(min)}, ${fmtNum(max)}]`);
    if (mean !== null) parts.push(`μ ${fmtNum(mean)}`);
    if (std !== null) parts.push(`σ ${fmtNum(std)}`);
    if (validPercent !== null) parts.push(`${fmtNum(validPercent)}% valid`);
  }
  if (band.scale !== 1 || band.offset !== 0) {
    parts.push(`scale ${fmtNum(band.scale)} offset ${fmtNum(band.offset)}`);
  }
  if (parts.length === 0) return null;
  return (
    <div className="meta-muted" style={{ marginLeft: 16 }}>
      {parts.join(" · ")}
    </div>
  );
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 1) return Number(n.toFixed(2)).toString();
  if (abs === 0) return "0";
  return Number(n.toPrecision(4)).toString();
}

function Items({ items }: { items: GdalItem[] }) {
  // Dataset-level first, then per-band.
  const sorted = [...items].sort((a, b) => {
    const sa = a.sample ?? -1;
    const sb = b.sample ?? -1;
    return sa - sb;
  });
  return (
    <ul className="meta-list mono">
      {sorted.map((it, i) => (
        <li key={i}>
          {it.sample !== null && (
            <span className="meta-muted">[band {it.sample}] </span>
          )}
          <strong>{it.name}</strong>
          {": "}
          {it.value || <span className="meta-muted">(empty)</span>}
        </li>
      ))}
    </ul>
  );
}

function RawXml({ raw }: { raw: string }) {
  const [copied, setCopied] = useState(false);
  const pretty = useMemo(() => prettyPrintGdalXml(raw), [raw]);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API can fail in non-secure contexts; surface nothing
      // rather than throwing.
    }
  };
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onCopy}
          style={{ padding: "2px 8px", fontSize: 11 }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="meta-xml">{pretty}</pre>
    </div>
  );
}
