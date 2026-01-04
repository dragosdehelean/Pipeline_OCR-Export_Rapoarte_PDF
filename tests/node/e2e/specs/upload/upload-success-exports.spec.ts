/**
 * @fileoverview Validates successful uploads and exported artifacts.
 *
 * Coverage: Upload success flow, exports availability, list status.
 * Dependencies: Next.js dev server, Python worker.
 * Run time: ~2 min.
 */
import { expect, test } from "@playwright/test";
import { FIXTURES, MIN_TEXT_CHARS, UPLOAD_TIMEOUT_MS } from "../../config/test-config";
import { deleteDoc, waitForDocCompletion } from "../../helpers/docs.helper";
import { buildUploadFilePayload } from "../../helpers/fixtures.helper";
import { gotoUploadPage, uploadFileAndGetDocId } from "../../helpers/upload.helper";
import { createDocsListPage } from "../../pages/docs-list.page";
import { createUploadPage } from "../../pages/upload.page";

test.describe.configure({ mode: "parallel" });

/**
 * Uploads a valid PDF and confirms the SUCCESS status with exports present.
 *
 * WHY: Ensure the happy path produces both Markdown and JSON artifacts.
 * Pre-conditions: Health check ok, worker running.
 */
test("upload valid PDF creates exports with SUCCESS status", async ({ page }, testInfo) => {
  // WHY: Processing can take up to the configured gate timeout.
  test.setTimeout(UPLOAD_TIMEOUT_MS * 2);
  await gotoUploadPage(page);

  const uploadPage = createUploadPage(page);
  const docsList = createDocsListPage(page);
  const { payload, fileName } = await buildUploadFilePayload(FIXTURES.goodPdf, testInfo);
  const docId = await uploadFileAndGetDocId(page, payload);
  const status = await waitForDocCompletion(page, docId);
  expect(status).toBe("SUCCESS");

  await expect(uploadPage.statusRegion).toContainText("Processing complete");

  const row = docsList.rowByFileName(fileName);
  // WHY: UI list polling can lag behind the API completion state.
  await expect(row.getByText(/^SUCCESS$/)).toBeVisible({ timeout: UPLOAD_TIMEOUT_MS });

  const mdResponse = await page.request.get(`/api/docs/${docId}/md`);
  expect(mdResponse.status()).toBe(200);
  const markdown = await mdResponse.text();
  expect(markdown.length).toBeGreaterThan(MIN_TEXT_CHARS);

  const jsonResponse = await page.request.get(`/api/docs/${docId}/json`);
  expect(jsonResponse.status()).toBe(200);
  const jsonText = await jsonResponse.text();
  const parsed = JSON.parse(jsonText);
  expect(Object.keys(parsed).length).toBeGreaterThan(0);

  await deleteDoc(page, docId);
});
