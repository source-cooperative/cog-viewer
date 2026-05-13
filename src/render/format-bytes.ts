const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Human-readable byte size. One decimal under 10, none at or above 10.
 * "1.5 GB", "64 MB", "9.5 KB", "1023 B". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let n = bytes;
  let unit = 0;
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024;
    unit++;
  }
  const formatted = n < 10 ? n.toFixed(1) : Math.round(n).toString();
  return `${formatted} ${UNITS[unit]}`;
}
