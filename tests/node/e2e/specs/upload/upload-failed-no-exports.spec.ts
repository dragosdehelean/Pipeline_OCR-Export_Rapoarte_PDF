/**
 * @fileoverview Validates failed uploads do not expose exports.
 *
 * Coverage: Upload failure flow, exports absence.
 * Dependencies: Next.js dev server, Python worker.
 * Run time: ~2 min.
 */
import { expect, test } from "@playwright/test";
import { FIXTURES, UPLOAD_TIMEOUT_MS } from "../../config/test-config";
import { deleteDoc, waitForDocCompletion } from "../../helpers/docs.helper";
import { buildUploadFilePayload } from "../../helpers/fixtures.helper";
import { gotoUploadPage, uploadFileAndGetDocId } from "../../helpers/upload.helper";
import { createUploadPage } from "../../pages/upload.page";

test.describe.configure({ mode: "parallel" });

/**
 * Uploads a file expected to fail and confirms exports are unavailable.
 *
 * WHY: Quality gates must block exports when processing fails.
 * Pre-conditions: Health check ok, worker running.
 */
test("upload rejected PDF shows FAILED status with no exports", async ({ page }, testInfo) => {
  // WHY: Processing can take up to the configured gate timeout.
  test.setTimeout(UPLOAD_TIMEOUT_MS * 2);
  await gotoUploadPage(page);

  const uploadPage = createUploadPage(page);
  const { payload } = await buildUploadFilePayload(FIXTURES.badPdf, testInfo);
  const docId = await uploadFileAndGetDocId(page, payload);
  const status = await waitForDocCompletion(page, docId);
  expect(status).toBe("FAILED");

  await expect(uploadPage.statusRegion).toContainText("Processing failed");

  const mdResponse = await page.request.get(`/api/docs/${docId}/md`);
  expect(mdResponse.status()).toBe(404);

  const jsonResponse = await page.request.get(`/api/docs/${docId}/json`);
  expect(jsonResponse.status()).toBe(404);

  await deleteDoc(page, docId);
});
