import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const goodPdf = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "docs",
  "short_valid_text.pdf"
);
const badPdf = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "docs",
  "scan_like_no_text.pdf"
);

const auditRoot = path.join(process.cwd(), "tests", "node", "e2e", "ux-audit");
const phase = process.env.UX_AUDIT_PHASE === "after" ? "after" : "before";
const outputDir = path.join(auditRoot, phase);
const dataDir =
  process.env.DATA_DIR ||
  path.join(process.cwd(), "tests", "node", "e2e", "data-test");

const viewports = {
  desktop: { width: 1280, height: 720 },
  mobile: { width: 390, height: 844 }
} as const;

async function ensureOutputDir() {
  await fs.mkdir(outputDir, { recursive: true });
}

async function resetDataDir() {
  await fs.rm(dataDir, { recursive: true, force: true });
}

async function waitForHealth(page: Page) {
  const response = await page.waitForResponse(
    (res) => res.url().includes("/api/health"),
    { timeout: 30000 }
  );
  const payload = await response.json().catch(() => null);
  if (!payload?.ok) {
    throw new Error(`Health check failed: ${JSON.stringify(payload)}`);
  }
}

async function stabilize(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    `
  });
}

function getDynamicMasks(page: Page) {
  return [
    page.locator("span", { hasText: "Created:" }),
    page.locator("div", { hasText: "Created" }),
    page.locator("div", { hasText: "Started" }),
    page.locator("div", { hasText: "Finished" }),
    page.locator("div", { hasText: "ID" }),
    page.locator("div", { hasText: "SHA-256" })
  ];
}

async function capture(
  page: Page,
  slug: string,
  viewport: keyof typeof viewports,
  state: string
) {
  await page.setViewportSize(viewports[viewport]);
  await page.waitForTimeout(150);
  const masks = getDynamicMasks(page);
  await page.screenshot({
    path: path.join(outputDir, `${slug}__${viewport}__${state}.png`),
    fullPage: true,
    mask: masks
  });
}

async function uploadFile(page: Page, filePath: string) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/docs/upload") &&
      response.request().method() === "POST"
  );
  await page.setInputFiles("input[type=file]", filePath);
  await expect(page.getByRole("button", { name: "Upload" })).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: "Upload" }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
}

test.describe("ux audit screenshots", () => {
  test("capture key states", async ({ page }) => {
    test.setTimeout(120000);
    await ensureOutputDir();
    await resetDataDir();

    await page.goto("/");
    await waitForHealth(page);
    await stabilize(page);

    await capture(page, "home-empty", "desktop", "default");
    await capture(page, "home-empty", "mobile", "default");

    await page.evaluate(() => {
      const form = document.querySelector("form.upload-zone");
      if (form) {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
    });
    await capture(page, "home", "desktop", "error-no-file");
    await capture(page, "home", "mobile", "error-no-file");

    let mockUpload = true;
    await page.route("**/api/docs/upload", async (route) => {
      if (mockUpload) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.fulfill({
          status: 202,
          body: "{}",
          headers: { "content-type": "application/json" }
        });
      } else {
        await route.continue();
      }
    });

    const uploadingResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/docs/upload") &&
        response.request().method() === "POST"
    );
    await page.setInputFiles("input[type=file]", goodPdf);
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByRole("button", { name: "Uploading..." })).toBeVisible();
    await capture(page, "home", "desktop", "uploading");
    await capture(page, "home", "mobile", "uploading");
    await uploadingResponsePromise;

    mockUpload = false;
    await page.unroute("**/api/docs/upload");

    await Promise.all([waitForHealth(page), page.reload()]);
    await stabilize(page);

    await uploadFile(page, goodPdf);
    await page.waitForSelector("a", { hasText: "short_valid_text.pdf" });
    await capture(page, "home", "desktop", "success");
    await capture(page, "home", "mobile", "success");

    await page.getByRole("link", { name: "short_valid_text.pdf" }).first().click();
    await page.waitForURL(/\/docs\//);
    await capture(page, "doc-success", "desktop", "default");
    await capture(page, "doc-success", "mobile", "default");

    await page.getByRole("link", { name: "Back to documents" }).click();
    await page.waitForURL("/");

    await uploadFile(page, badPdf);
    await page.waitForSelector("a", { hasText: "scan_like_no_text.pdf" });
    await capture(page, "home", "desktop", "with-failed");
    await capture(page, "home", "mobile", "with-failed");

    await page.getByRole("searchbox", { name: "Search documents" }).fill("scan_like");
    await capture(page, "home", "desktop", "search");
    await page.getByRole("button", { name: "Clear" }).click();

    await page.getByRole("tab", { name: "Failed" }).click();
    await capture(page, "home", "desktop", "filter-failed");

    await page.getByRole("link", { name: "scan_like_no_text.pdf" }).first().click();
    await page.waitForURL(/\/docs\//);
    await capture(page, "doc-failed", "desktop", "default");
    await capture(page, "doc-failed", "mobile", "default");
  });
});
