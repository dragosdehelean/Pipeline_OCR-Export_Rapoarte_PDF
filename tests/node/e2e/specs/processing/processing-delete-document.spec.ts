/**
 * @fileoverview Ensures deleting a document removes it from the list.
 *
 * Coverage: Delete modal confirmation and list removal.
 * Dependencies: Next.js dev server, Python worker.
 * Run time: ~2 min.
 */
import { expect, test } from "@playwright/test";
import { FIXTURES, UPLOAD_TIMEOUT_MS } from "../../config/test-config";
import { waitForDocCompletion } from "../../helpers/docs.helper";
import { buildUploadFilePayload } from "../../helpers/fixtures.helper";
import { gotoUploadPage, uploadFileAndGetDocId } from "../../helpers/upload.helper";
import { createDocsListPage } from "../../pages/docs-list.page";

test.describe.configure({ mode: "parallel" });

/**
 * Uploads a document, waits for completion, and deletes it via the UI.
 *
 * WHY: Users must be able to remove documents and see immediate feedback.
 * Pre-conditions: Health check ok, worker running.
 */
test("delete document removes row from list", async ({ page }, testInfo) => {
  // WHY: Processing can take up to the configured gate timeout.
  test.setTimeout(UPLOAD_TIMEOUT_MS * 2);
  await gotoUploadPage(page);

  const docsList = createDocsListPage(page);
  const { payload, fileName } = await buildUploadFilePayload(FIXTURES.goodPdf, testInfo);
  const docId = await uploadFileAndGetDocId(page, payload);
  await waitForDocCompletion(page, docId);

  const row = docsList.rowByFileName(fileName);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: "Confirm deletion" })).toBeVisible();

  // WHY: Wait for the DELETE call to finish before asserting UI removal.
  const deleteResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/docs/${docId}`) &&
      response.request().method() === "DELETE",
    { timeout: UPLOAD_TIMEOUT_MS }
  );
  await page.getByRole("button", { name: "Yes, delete" }).click();
  const deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.ok()).toBeTruthy();

  await expect(row).toHaveCount(0);
});
