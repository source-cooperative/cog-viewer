/**
 * Diagnostic: wrap window.fetch and log the call site any time an
 * outgoing Range header is malformed (`end < start`, negative-end,
 * non-numeric, etc). Used to track down the NLCD "whole file
 * downloaded" symptom — the offending request was
 * `bytes=962592768-32767` and we don't yet know which library frame
 * is generating that bad length.
 *
 * Removable: delete this file and its import from main.tsx.
 */
const original = window.fetch.bind(window);

function getRange(init?: RequestInit | Request): string | null {
  if (!init) return null;
  if (init instanceof Request) {
    return init.headers.get("range") ?? init.headers.get("Range");
  }
  const h = init.headers;
  if (!h) return null;
  if (h instanceof Headers) return h.get("range") ?? h.get("Range");
  if (Array.isArray(h)) {
    for (const [k, v] of h) {
      if (k.toLowerCase() === "range") return v;
    }
    return null;
  }
  const obj = h as Record<string, string>;
  return obj.range ?? obj.Range ?? null;
}

function isMalformed(range: string | null): boolean {
  if (!range) return false;
  const m = range.match(/^bytes=(-?\d+)-(-?\d+)$/);
  if (!m) return false;
  const start = Number(m[1]);
  const end = Number(m[2]);
  return !Number.isFinite(start) || !Number.isFinite(end) || end < start;
}

window.fetch = function trap(input, init) {
  const range =
    getRange(init) ??
    (input instanceof Request
      ? input.headers.get("range") ?? input.headers.get("Range")
      : null);
  if (isMalformed(range)) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    // eslint-disable-next-line no-console
    console.warn(
      `[range-trap] malformed Range header on outgoing request:\n  url: ${url}\n  range: ${range}`,
      new Error("malformed-range stack trace"),
    );
  }
  return original(input as RequestInfo, init);
};
