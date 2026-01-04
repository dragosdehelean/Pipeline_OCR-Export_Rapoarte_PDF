/**
 * @fileoverview STANDARD E2E TESTS - Core functionality
 * Run these in CI - balanced between speed and coverage (~3-4 minutes)
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
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
const badPdf = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "docs",
  "scan_like_no_text.pdf"
);
const longReportPdf = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "docs",
  "long_report.pdf"
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

function minRequiredForMetric(metric: string) {
  let min = 0;
  for (const gate of gatesConfig?.gates ?? []) {
    if (!gate?.enabled || gate?.severity !== "FAIL" || gate?.metric !== metric) {
      continue;
    }
    const threshold = Number(gate?.threshold ?? 0);
    if (gate.op === ">") {
      min = Math.max(min, threshold + 1);
    } else if (gate.op === ">=" || gate.op === "==") {
      min = Math.max(min, threshold);
    } else if (gate.op === "!=") {
      min = Math.max(min, threshold + 1);
    }
  }
  return min;
}

const minTextChars = minRequiredForMetric("textChars");

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

  return uploadResponsePromise;
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

async function getDocRowById(page: Page, docId: string): Promise<Locator> {
  const row = page.locator(`tr[data-doc-id="${docId}"]`);
  await expect(row).toBeVisible();
  return row;
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

test.describe("standard tests", () => {
  test("good pdf -> SUCCESS -> exports created", async ({ page }) => {
    test.setTimeout(uploadTimeoutMs * 2);
    await gotoAndWaitForUploadReady(page);

    await page.setInputFiles("input[type=file]", goodPdf);
    const goodId = await uploadFileAndGetDocId(page);

    await expect(
      page.locator(".alert-title", { hasText: "Processing complete" })
    ).toBeVisible({ timeout: uploadTimeoutMs });

    const goodRow = await getDocRowById(page, goodId);
    const goodStatus = goodRow.locator(".badge");
    await expect(goodStatus).toBeVisible();
    await expect.poll(
      async () => (await goodStatus.textContent())?.trim(),
      { timeout: uploadTimeoutMs }
    ).toBe("SUCCESS");

    // Verify exports exist via API
    const mdResponse = await page.request.get(`/api/docs/${goodId}/md`);
    expect(mdResponse.status()).toBe(200);
    const markdown = await mdResponse.text();
    expect(markdown.length).toBeGreaterThan(minTextChars);

    const jsonResponse = await page.request.get(`/api/docs/${goodId}/json`);
    expect(jsonResponse.status()).toBe(200);
    const jsonText = await jsonResponse.text();
    const parsed = JSON.parse(jsonText);
    expect(Object.keys(parsed).length).toBeGreaterThan(0);

    await page.request.delete(`/api/docs/${goodId}`);
  });

  test("bad pdf -> FAILED -> no exports", async ({ page }) => {
    test.setTimeout(uploadTimeoutMs * 2);
    await gotoAndWaitForUploadReady(page);

    await page.setInputFiles("input[type=file]", badPdf);
    const badId = await uploadFileAndGetDocId(page);

    await expect(
      page.locator(".alert-title", { hasText: "Processing failed" })
    ).toBeVisible({ timeout: uploadTimeoutMs });

    const badRow = await getDocRowById(page, badId);
    const badStatus = badRow.locator(".badge");
    await expect(badStatus).toBeVisible();
    await expect.poll(
      async () => (await badStatus.textContent())?.trim(),
      { timeout: uploadTimeoutMs }
    ).toBe("FAILED");

    // Verify NO exports
    const mdResponse = await page.request.get(`/api/docs/${badId}/md`);
    expect(mdResponse.status()).toBe(404);

    const jsonResponse = await page.request.get(`/api/docs/${badId}/json`);
    expect(jsonResponse.status()).toBe(404);

    await page.request.delete(`/api/docs/${badId}`);
  });

  test("delete document removes from list", async ({ page }) => {
    test.setTimeout(uploadTimeoutMs * 2);
    await gotoAndWaitForUploadReady(page);

    await page.setInputFiles("input[type=file]", goodPdf);
    const docId = await uploadFileAndGetDocId(page);

    const row = await getDocRowById(page, docId);
    await expect(row.locator(".badge")).toBeVisible();
    await waitForDocCompletion(page, docId);

    await row.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("heading", { name: "Confirm deletion" })).toBeVisible();
    const deleteResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/docs/${docId}`) &&
        response.request().method() === "DELETE",
      { timeout: uploadTimeoutMs }
    );
    await page.getByRole("button", { name: "Yes, delete" }).click();

    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.ok()).toBeTruthy();

    await expect(
      page.locator(".alert-title", { hasText: "Document deleted successfully" })
    ).toBeVisible({ timeout: uploadTimeoutMs });

    await expect(row).not.toBeVisible({ timeout: uploadTimeoutMs });
  });

  test("pymupdf4llm one_page_report succeeds", async ({ page }) => {
    test.setTimeout(uploadTimeoutMs * 2);
    await gotoAndWaitForUploadReady(page);

    const healthResponse = await page.request.get("/api/health");
    const healthPayload = await healthResponse.json().catch(() => null);
    const pymupdfAvailable =
      healthPayload?.pymupdf?.availability?.pymupdf4llm?.available === true;
    test.skip(!pymupdfAvailable, "pymupdf4llm is not available in this environment.");

    await page.setInputFiles("input[type=file]", goodPdf);
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

    if (status === "SUCCESS") {
      expect(meta.qualityGates?.passed).toBe(true);
      expect(meta.metrics?.textChars).toBeGreaterThan(500);
      expect(meta.outputs?.markdownPath).toBeTruthy();
      expect(meta.outputs?.jsonPath).toBeTruthy();
    }

    await page.request.delete(`/api/docs/${docId}`);
  });

  test("pymupdf4llm long_report basic validation", async ({ page }) => {
    test.setTimeout(uploadTimeoutMs * 2);
    await gotoAndWaitForUploadReady(page);

    const healthResponse = await page.request.get("/api/health");
    const healthPayload = await healthResponse.json().catch(() => null);
    const pymupdfAvailable =
      healthPayload?.pymupdf?.availability?.pymupdf4llm?.available === true;
    test.skip(!pymupdfAvailable, "pymupdf4llm is not available in this environment.");

    await page.setInputFiles("input[type=file]", longReportPdf);
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

    if (status === "SUCCESS") {
      expect(meta.qualityGates?.passed).toBe(true);
      expect(meta.metrics?.pages).toBe(19);
      expect(meta.metrics?.textChars).toBeGreaterThan(1000);
      expect(meta.outputs?.markdownPath).toBeTruthy();
    }

    await page.request.delete(`/api/docs/${docId}`);
  });
});
