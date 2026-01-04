/**
 * @fileoverview Captures UX audit screenshots for key UI states.
 *
 * Coverage: Upload form, list filters, details page states.
 * Dependencies: Next.js dev server, Python worker.
 * Run time: ~3-5 min.
 */
import { expect, test } from "@playwright/test";
import path from "node:path";
import { FIXTURES, UPLOAD_TIMEOUT_MS } from "../../config/test-config";
import { waitForHealthOk } from "../../helpers/health.helper";
import { buildUploadFilePayload } from "../../helpers/fixtures.helper";
import { uploadFile } from "../../helpers/upload.helper";
import { createDocsListPage } from "../../pages/docs-list.page";
import { createUploadPage } from "../../pages/upload.page";
import {
  AUDIT_ROOT,
  captureAuditScreenshot,
  createDeferred,
  ensureAuditOutputDir,
  resetAuditDataDir,
  stabilizePage
} from "../../helpers/ux-audit.helper";

test.describe.configure({ mode: "parallel" });

/**
 * @slow ~3-5 minutes
 * WHY SLOW: Captures multiple UI states with real uploads and screenshots.
 * WHEN TO RUN: Optional UX audit runs and visual regression checks.
 *
 * WHY: Keeps visual coverage in sync with key user journeys.
 * Pre-conditions: UX audit output directories writable.
 */
test("capture key ux states @slow", async ({ page }, testInfo) => {
  test.slow();
  // WHY: Multiple uploads plus screenshot capture can exceed the default timeout.
  test.setTimeout(UPLOAD_TIMEOUT_MS * 4);

  const phase = process.env.UX_AUDIT_PHASE === "after" ? "after" : "before";
  const outputDir = path.join(AUDIT_ROOT, phase);
  await ensureAuditOutputDir(outputDir);
  await resetAuditDataDir();

  await page.goto("/");
  await waitForHealthOk(page);
  await stabilizePage(page);

  await captureAuditScreenshot(page, outputDir, "home-empty", "desktop", "default");
  await captureAuditScreenshot(page, outputDir, "home-empty", "mobile", "default");

  const uploadPage = createUploadPage(page);
  // WHY: Trigger submit without file selection to capture validation state.
  await uploadPage.uploadForm.dispatchEvent("submit", { bubbles: true, cancelable: true });
  await captureAuditScreenshot(page, outputDir, "home", "desktop", "error-no-file");
  await captureAuditScreenshot(page, outputDir, "home", "mobile", "error-no-file");

  const deferred = createDeferred();
  // WHY: Hold the upload response to capture the "Uploading..." state.
  await page.route("**/api/docs/upload", async (route) => {
    await deferred.promise;
    await route.fulfill({
      status: 202,
      body: "{}",
      headers: { "content-type": "application/json" }
    });
  });

  const { payload: goodPayload, fileName: goodFileName } =
    await buildUploadFilePayload(FIXTURES.goodPdf, testInfo, FIXTURES.goodPdf.baseName);
  // WHY: Use the upload timeout from quality gates while holding the response.
  const uploadResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/docs/upload") &&
      response.request().method() === "POST",
    { timeout: UPLOAD_TIMEOUT_MS }
  );
  await uploadPage.fileInput.setInputFiles(goodPayload);
  await uploadPage.uploadButton.click();
  await expect(page.getByRole("button", { name: "Uploading..." })).toBeVisible();
  await captureAuditScreenshot(page, outputDir, "home", "desktop", "uploading");
  await captureAuditScreenshot(page, outputDir, "home", "mobile", "uploading");

  deferred.resolve();
  await uploadResponsePromise;
  await page.unroute("**/api/docs/upload");

  await page.reload();
  await waitForHealthOk(page);
  await stabilizePage(page);

  await uploadFile(page, goodPayload);
  await expect(page.getByRole("link", { name: goodFileName })).toBeVisible();
  await captureAuditScreenshot(page, outputDir, "home", "desktop", "success");
  await captureAuditScreenshot(page, outputDir, "home", "mobile", "success");

  await page.getByRole("link", { name: goodFileName }).click();
  await page.waitForURL(/\/docs\//);
  await captureAuditScreenshot(page, outputDir, "doc-success", "desktop", "default");
  await captureAuditScreenshot(page, outputDir, "doc-success", "mobile", "default");

  await page.getByRole("link", { name: "Back to documents" }).click();
  await page.waitForURL("/");

  const { payload: badPayload, fileName: badFileName } = await buildUploadFilePayload(
    FIXTURES.badPdf,
    testInfo,
    FIXTURES.badPdf.baseName
  );
  await uploadFile(page, badPayload);
  await expect(page.getByRole("link", { name: badFileName })).toBeVisible();
  await captureAuditScreenshot(page, outputDir, "home", "desktop", "with-failed");
  await captureAuditScreenshot(page, outputDir, "home", "mobile", "with-failed");

  const docsList = createDocsListPage(page);
  await docsList.searchInput.fill("scan_like");
  await captureAuditScreenshot(page, outputDir, "home", "desktop", "search");
  await page.getByRole("button", { name: "Clear" }).click();

  await docsList.statusTab("Failed").click();
  await captureAuditScreenshot(page, outputDir, "home", "desktop", "filter-failed");

  await page.getByRole("link", { name: badFileName }).click();
  await page.waitForURL(/\/docs\//);
  await captureAuditScreenshot(page, outputDir, "doc-failed", "desktop", "default");
  await captureAuditScreenshot(page, outputDir, "doc-failed", "mobile", "default");
});
