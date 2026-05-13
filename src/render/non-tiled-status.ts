import {
  SIZE_GATE_BYTES,
  type NonTiledSizes,
} from "./non-tiled-sizes";

export { SIZE_GATE_BYTES };

export type NonTiledStatus =
  | null
  | { kind: "auto"; decodedBytes: number; diskBytes: number }
  | { kind: "confirm"; decodedBytes: number; diskBytes: number }
  | { kind: "confirmed"; decodedBytes: number; diskBytes: number };

export const initialStatus: NonTiledStatus = null;

/** Derive the initial status (auto vs confirm) from raw sizes. The
 * worst of (decoded, disk) decides — JPEG-compressed stripped TIFFs
 * are small on disk but huge after decode. */
export function statusFromSizes(sizes: NonTiledSizes): NonTiledStatus {
  const worst = Math.max(sizes.decodedBytes, sizes.diskBytes);
  const kind = worst > SIZE_GATE_BYTES ? "confirm" : "auto";
  return { kind, decodedBytes: sizes.decodedBytes, diskBytes: sizes.diskBytes };
}

/** Whether the renderer should run for the current status. */
export function shouldRender(status: NonTiledStatus): boolean {
  return status?.kind === "auto" || status?.kind === "confirmed";
}
