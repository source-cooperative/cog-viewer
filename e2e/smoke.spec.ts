import { expect, test } from "@playwright/test";

/**
 * Smoke test: confirms the app renders without module-initialization errors,
 * React ErrorBoundary activations, or unhandled exceptions.
 *
 * Runs against the Vite dev server so the native Vite error overlay (the
 * full-screen dialog the dev server shows for module-level throws) is
 * detectable alongside the React ErrorBoundary that production builds show.
 */
test("app loads without JS errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: Error[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err));

  await page.goto("/");

  // Wait for the map canvas — MapLibre initialization confirms core JS ran
  // without throwing. Fall through after a timeout if WebGL is unavailable
  // (headless software rendering) so the overlay/boundary checks still run.
  await page.waitForSelector("canvas", { timeout: 10_000 }).catch(() => {});

  // Vite dev overlay: a custom element added to <body> when a module throws
  // during initialization. Uses Shadow DOM, so we query inside evaluate().
  const viteOverlayText: string | null = await page.evaluate(() => {
    const el = document.querySelector("vite-error-overlay");
    if (!el) return null;
    const shadow = (el as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot;
    const body = shadow?.querySelector(".message-body");
    return body?.textContent ?? shadow?.textContent ?? el.textContent ?? "(no message)";
  });

  if (viteOverlayText !== null) {
    throw new Error(`Vite error overlay appeared:\n\n${viteOverlayText.trim()}`);
  }

  // React ErrorBoundary: our fallback renders an <h2>Something went wrong</h2>
  // and a <pre> with the error message + component stack (added in this PR).
  const boundaryHeading = page.locator("h2", { hasText: "Something went wrong" });
  if ((await boundaryHeading.count()) > 0) {
    const detail = await page
      .locator("pre")
      .first()
      .textContent()
      .catch(() => "(no detail available)");
    throw new Error(`React ErrorBoundary triggered:\n\n${detail?.trim()}`);
  }

  // Uncaught page-level exceptions (errors not caught by any boundary).
  if (pageErrors.length > 0) {
    throw new Error(
      `Uncaught page errors:\n${pageErrors.map((e) => `  ${e.message}`).join("\n")}`,
    );
  }

  // Console errors — exclude expected noise from network failures in the
  // offline CI environment (tile/basemap fetches) and known WebGL messages
  // from software-rendered headless Chrome.
  // "Failed to load resource" is the browser's console format for HTTP errors
  // on non-JS resources (tiles, sprites, fonts). JS module 404s surface as
  // pageerror events (checked above), so this class is safe to exclude.
  const meaningful = consoleErrors.filter(
    (msg) =>
      !msg.includes("net::ERR_") &&
      !msg.includes("Failed to fetch") &&
      !msg.includes("Failed to load resource") &&
      !msg.includes("WebGL") &&
      !msg.includes("WEBGL"),
  );
  expect(
    meaningful,
    `Unexpected console errors:\n${meaningful.map((m) => `  ${m}`).join("\n")}`,
  ).toHaveLength(0);
});
