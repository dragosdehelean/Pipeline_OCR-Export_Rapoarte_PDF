/**
 * @fileoverview COMPREHENSIVE upload tests - Detailed validation
 * Run less frequently (nightly/pre-release) - takes ~5-10 minutes
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
const unsupportedFile = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "docs",
  "unsupported.txt"
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
const maxFileSizeMb = Number(gatesConfig?.limits?.maxFileSizeMb);
const acceptLabel = Array.isArray(gatesConfig?.accept?.extensions)
  ? gatesConfig.accept.extensions.join(", ")
  : "";

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

async function uploadFile(page: Page, filePath: string): Promise<string> {
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

async function waitForDocStatus(page: Page, docId: string, expectedStatus: string) {
  await expect.poll(
    async () => {
      const response = await page.request.get(`/api/docs/${docId}`);
      if (!response.ok()) {
        return "UNKNOWN";
      }
      const meta = await response.json().catch(() => null);
      return meta?.processing?.status ?? "PENDING";
    },
    { timeout: uploadTimeoutMs }
  ).toBe(expectedStatus);
}

test.describe("upload comprehensive tests", () => {
  test("all docling profiles succeed", async ({ page }) => {
    test.setTimeout(uploadTimeoutMs * 6);
    await gotoAndWaitForUploadReady(page);

    const advanced = page.locator("details.advanced-panel");
    await advanced.evaluate((el) => el.setAttribute("open", "open"));
    const profileSelect = page.locator("#profile-override");
    await expect(profileSelect).toBeVisible();

    const profileValues = (
      await profileSelect
        .locator("option")
        .evaluateAll((options) => options.map((option) => option.getAttribute("value") ?? ""))
    ).filter(Boolean);

    console.log(`Testing ${profileValues.length} docling profiles:`, profileValues);

    for (const profile of profileValues) {
      console.log(`Testing profile: ${profile}`);
      await advanced.evaluate((el) => el.setAttribute("open", "open"));
      await profileSelect.selectOption(profile);

      const docId = await uploadFile(page, goodPdf);
      await waitForDocStatus(page, docId, "SUCCESS");

      const deleteResponse = await page.request.delete(`/api/docs/${docId}`);
      expect(deleteResponse.ok()).toBeTruthy();
    }
  });

  test("full upload flow with UI validation", async ({ page }) => {
    test.setTimeout(uploadTimeoutMs * 2);

    // Mock clipboard for copy functionality
    await page.addInitScript(() => {
      let clipboardText = "";
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text: string) => {
            clipboardText = text;
          },
          readText: async () => clipboardText
        },
        configurable: true
      });
      (window as Window & { __getClipboardText?: () => string }).__getClipboardText =
        () => clipboardText;
    });

    await gotoAndWaitForUploadReady(page);

    // Verify upload constraints displayed
    await expect(page.getByText(`Allowed: ${acceptLabel}`)).toBeVisible();
    await expect(page.getByText(`Max file size: ${maxFileSizeMb} MB`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload" })).toBeDisabled();

    // Test unsupported file validation
    await page.setInputFiles("input[type=file]", unsupportedFile);
    await expect(
      page.getByText(`Unsupported file type. Allowed: ${acceptLabel}.`)
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload" })).toBeDisabled();
    await page.getByRole("button", { name: "Clear selection" }).click();

    // Test file selection + clear
    await page.setInputFiles("input[type=file]", goodPdf);
    await expect(page.getByTestId("selected-file")).toContainText("one_page_report.pdf");
    await page.getByRole("button", { name: "Clear selection" }).click();
    await expect(page.getByTestId("selected-file")).toHaveCount(0);

    // Upload and verify
    await page.setInputFiles("input[type=file]", goodPdf);
    const docId = await uploadFile(page, goodPdf);

    await expect(
      page.locator(".alert-title", { hasText: "Processing complete" })
    ).toBeVisible({ timeout: uploadTimeoutMs });

    // Navigate to details page
    await page.goto(`/docs/${docId}`);

    // Verify exports UI
    await expect(page.getByRole("heading", { name: "Exports" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download Markdown" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download JSON" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Markdown" })).toBeVisible();
    await expect(page.getByRole("button", { name: "JSON" })).toBeVisible();

    // Test markdown copy
    await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
    await page.getByRole("button", { name: "Copy" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    const copiedMarkdown = await page.evaluate(
      () =>
        (window as Window & { __getClipboardText?: () => string }).__getClipboardText?.() ?? ""
    );
    expect(copiedMarkdown.trim().length).toBeGreaterThan(0);

    // Test JSON copy
    await page.getByRole("button", { name: "JSON" }).click();
    await page.getByRole("button", { name: "Copy" }).click();
    const copiedJson = await page.evaluate(
      () =>
        (window as Window & { __getClipboardText?: () => string }).__getClipboardText?.() ?? ""
    );
    expect(copiedJson).toContain("\n  ");
    const parsedPreviewJson = JSON.parse(copiedJson);
    expect(Object.keys(parsedPreviewJson).length).toBeGreaterThan(0);

    // Verify preview styling
    const previewStyles = await page.evaluate(() => {
      const pre = document.querySelector(".preview-pre");
      if (!pre) return null;
      const styles = getComputedStyle(pre);
      return { maxHeight: styles.maxHeight, overflowY: styles.overflowY };
    });
    expect(previewStyles).not.toBeNull();
    expect(previewStyles?.maxHeight).toBe("420px");
    expect(previewStyles?.overflowY).toBe("auto");

    // Verify no horizontal scroll
    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalScroll).toBeFalsy();

    // Cleanup
    await page.request.delete(`/api/docs/${docId}`);
  });
});
