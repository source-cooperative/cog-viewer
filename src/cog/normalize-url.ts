/**
 * Normalize a user-supplied COG URL before fetching.
 *
 * source.coop hosts two distinct services under different hostnames:
 *   - https://source.coop/   — Next.js web UI, returns HTML, no CORS headers.
 *   - https://data.source.coop/ — actual file storage, CORS *, Range support.
 *
 * A user who copies a URL from the source.coop UI gets the web-UI hostname.
 * Cross-origin fetch to that host fails with a CORS error (the HTML page has no
 * Access-Control-Allow-Origin header).  Rewrite to the data hostname so the
 * fetch succeeds from any origin.
 */
export function normalizeUrl(url: string): string {
  if (url.startsWith("https://source.coop/")) {
    return "https://data.source.coop/" + url.slice("https://source.coop/".length);
  }
  return url;
}
