/**
 * @fileoverview Helpers for UX audit screenshots and stabilization.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";

export const AUDIT_ROOT = path.join(process.cwd(), "tests", "node", "e2e", "ux-audit");
export const AUDIT_DATA_DIR =
  process.env.DATA_DIR || path.join(process.cwd(), "tests", "node", "e2e", "data-test");

export const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  mobile: { width: 390, height: 844 }
} as const;

type ViewportKey = keyof typeof VIEWPORTS;

/**
 * Ensures the audit output directory exists.
 */
export async function ensureAuditOutputDir(outputDir: string) {
  await fs.mkdir(outputDir, { recursive: true });
}

/**
 * Clears the audit data directory for clean screenshots.
 */
export async function resetAuditDataDir() {
  await fs.rm(AUDIT_DATA_DIR, { recursive: true, force: true });
}

/**
 * Disables animations and transitions for stable screenshots.
 */
export async function stabilizePage(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    `
  });
}

/**
 * Returns locators to mask dynamic values (timestamps, ids) in screenshots.
 */
export function getDynamicMasks(page: Page): Locator[] {
  return [
    page.getByText("Created"),
    page.getByText("Started"),
    page.getByText("Finished"),
    page.getByText("ID"),
    page.getByText("SHA-256")
  ];
}

/**
 * Captures a stabilized screenshot for a viewport and state label.
 */
export async function captureAuditScreenshot(
  page: Page,
  outputDir: string,
  slug: string,
  viewport: ViewportKey,
  state: string
) {
  const size = VIEWPORTS[viewport];
  await page.setViewportSize(size);
  await page.waitForFunction(
    (expected) =>
      window.innerWidth === expected.width && window.innerHeight === expected.height,
    size
  );
  await page.waitForLoadState("domcontentloaded");
  const masks = getDynamicMasks(page);
  await page.screenshot({
    path: path.join(outputDir, `${slug}__${viewport}__${state}.png`),
    fullPage: true,
    mask: masks
  });
}

/**
 * Creates a deferred promise used to control mocked network responses.
 */
export function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
