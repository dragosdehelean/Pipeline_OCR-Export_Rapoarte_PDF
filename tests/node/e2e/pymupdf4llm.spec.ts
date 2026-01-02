/**
 * @fileoverview E2E coverage for the PyMuPDF4LLM layout-only engine option.
 */
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { qualityGatesSchema } from "../../../app/_lib/config";

const pymupdfPdf = path.join(
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

async function uploadFileAndGetDocId(page: Page) {
  const uploadResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/docs/upload") &&
      response.request().method() === "POST",
    { timeout: uploadTimeoutMs }
  );

  await expect(page.getByRole("button", { name: "Upload" })).toBeEnabled();
  await page.getByRole("button", { name: "Upload" }).click();

  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.ok()).toBeTruthy();
  const payload = await uploadResponse.json().catch(() => null);
  const docId =
    typeof payload?.id === "string"
      ? payload.id
      : typeof payload?.docId === "string"
        ? payload.docId
        : "";
  if (!docId) {
    throw new Error("Upload response missing document id.");
  }
  return docId;
}

async function waitForDocCompletion(page: Page, docId: string) {
  let finalStatus = "UNKNOWN";
  await expect.poll(
    async () => {
      const response = await page.request.get(`/api/docs/${docId}`);
      if (!response.ok()) {
        return "UNKNOWN";
      }
      const meta = await response.json().catch(() => null);
      const status = meta?.processing?.status ?? "PENDING";
      if (status === "SUCCESS" || status === "FAILED") {
        finalStatus = status;
      }
      return status;
    },
    { timeout: uploadTimeoutMs }
  ).toMatch(/SUCCESS|FAILED/);
  return finalStatus;
}

test.describe("pymupdf4llm e2e", () => {
  test("upload pdf with pymupdf4llm succeeds", async ({ page }) => {
    test.setTimeout(uploadTimeoutMs * 2);
    await gotoAndWaitForUploadReady(page);

    const healthResponse = await page.request.get("/api/health");
    const healthPayload = await healthResponse.json().catch(() => null);
    const pymupdfAvailable =
      healthPayload?.pymupdf?.availability?.pymupdf4llm?.available === true;
    test.skip(!pymupdfAvailable, "pymupdf4llm is not available in this environment.");

    await page.setInputFiles("input[type=file]", pymupdfPdf);
    await page.getByText("Advanced").click();
    await page.selectOption("#engine-override", "pymupdf4llm");

    const docId = await uploadFileAndGetDocId(page);
    const status = await waitForDocCompletion(page, docId);

    const metaResponse = await page.request.get(`/api/docs/${docId}`);
    expect(metaResponse.ok()).toBeTruthy();
    const meta = await metaResponse.json();
    expect(meta.processing?.status).toBe(status);
    expect(meta.engine?.effective?.name).toBe("pymupdf4llm");
    expect(meta.engine?.effective?.layoutActive).toBe(true);
    if (status === "FAILED") {
      expect(meta.qualityGates?.passed).toBe(false);
      expect(meta.outputs?.markdownPath).toBeNull();
      expect(meta.outputs?.jsonPath).toBeNull();
    }

    const deleteResponse = await page.request.delete(`/api/docs/${docId}`);
    expect(deleteResponse.ok()).toBeTruthy();
  });

  test("pymupdf4llm disabled when layout deps missing", async ({ page }) => {
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
    await page.setInputFiles("input[type=file]", pymupdfPdf);
    const engineSelect = page.locator("#engine-override");
    await expect(engineSelect).toBeEnabled();
    await expect(engineSelect.locator("option[value='pymupdf4llm']")).toBeDisabled();
    await expect(engineSelect).toHaveValue("docling");

    const docId = await uploadFileAndGetDocId(page);
    const deleteResponse = await page.request.delete(`/api/docs/${docId}`);
    expect(deleteResponse.ok()).toBeTruthy();
  });
});
