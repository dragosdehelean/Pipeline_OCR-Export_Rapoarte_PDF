/**
 * @fileoverview SMOKE TESTS - Fast basic functionality checks
 * Run these frequently during development (takes ~1-2 minutes total)
 */
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { qualityGatesSchema } from "../../../app/_lib/config";

const goodPdf = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "docs",
  "one_page_report.pdf"
);

const gatesConfig = qualityGatesSchema.parse(
  JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "config", "quality-gates.json"),
      "utf-8"
    )
  )
);

const processTimeoutSec = Number(gatesConfig?.limits?.processTimeoutSec);
if (!Number.isFinite(processTimeoutSec) || processTimeoutSec <= 0) {
  throw new Error("Invalid limits.processTimeoutSec in quality-gates.json");
}
const uploadTimeoutMs = processTimeoutSec * 1000;

async function gotoAndWaitForUploadReady(page: Page) {
  const healthResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/health"),
    { timeout: 30000 }
  );

  await page.goto("/");
  const healthResponse = await healthResponsePromise;
  const healthPayload = await healthResponse.json().catch(() => null);

  if (!healthPayload?.ok) {
    throw new Error(`Health check failed: ${JSON.stringify(healthPayload)}`);
  }
  await page.waitForSelector("input[type='file']", { timeout: 30000 });
}

async function uploadFile(page: Page, filePath: string) {
  const uploadResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/docs/upload") &&
      response.request().method() === "POST",
    { timeout: uploadTimeoutMs }
  );

  await page.setInputFiles("input[type=file]", filePath);
  await expect(page.getByRole("button", { name: "Upload" })).toBeEnabled();
  await page.getByRole("button", { name: "Upload" }).click();

  const uploadResponse = await uploadResponsePromise;
  return uploadResponse;
}

test.describe("smoke tests", () => {
  test("health check passes", async ({ page }) => {
    test.setTimeout(30000); // 30s max
    await page.goto("/");

    const healthResponse = await page.request.get("/api/health");
    expect(healthResponse.ok()).toBeTruthy();

    const healthPayload = await healthResponse.json();
    expect(healthPayload?.ok).toBe(true);
  });

  test("upload form renders", async ({ page }) => {
    test.setTimeout(30000); // 30s max
    await gotoAndWaitForUploadReady(page);

    // Verify UI elements are present
    await expect(page.locator("input[type='file']")).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload" })).toBeDisabled();
  });

  test("upload accepts PDF and returns docId", async ({ page }) => {
    test.setTimeout(60000); // 1 min max - NO waiting for processing
    await gotoAndWaitForUploadReady(page);

    const uploadResponse = await uploadFile(page, goodPdf);
    expect(uploadResponse.ok()).toBeTruthy();

    const payload = await uploadResponse.json().catch(() => null);
    const docId =
      typeof payload?.id === "string"
        ? payload.id
        : typeof payload?.docId === "string"
          ? payload.docId
          : "";

    expect(docId).toBeTruthy();

    // Cleanup WITHOUT waiting for completion
    await page.request.delete(`/api/docs/${docId}`);
  });

  test("pymupdf4llm disabled when deps missing", async ({ page }) => {
    test.setTimeout(60000); // 1 min max

    await page.route("**/api/health", async (route) => {
      const response = await route.fetch();
      const payload = await response.json().catch(() => null);
      if (!payload || typeof payload !== "object") {
        return route.fulfill({ response });
      }
      const nextPayload = {
        ...payload,
        pymupdf: payload.pymupdf
          ? {
              ...payload.pymupdf,
              availability: {
                pymupdf4llm: {
                  available: false,
                  reason: "IMPORT_PYMUPDF_LAYOUT_FAILED"
                }
              }
            }
          : null
      };
      return route.fulfill({ response, json: nextPayload });
    });

    await gotoAndWaitForUploadReady(page);

    await page.getByText("Advanced").click();
    await page.setInputFiles("input[type=file]", goodPdf);
    const engineSelect = page.locator("#engine-override");
    await expect(engineSelect).toBeEnabled();
    await expect(engineSelect.locator("option[value='pymupdf4llm']")).toBeDisabled();
    await expect(engineSelect).toHaveValue("docling");

    // No need to actually upload - we only tested UI state
  });
});
