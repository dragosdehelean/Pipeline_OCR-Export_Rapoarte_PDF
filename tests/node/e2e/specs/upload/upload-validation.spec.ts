/**
 * @fileoverview Validates upload form constraints and file selection UX.
 *
 * Coverage: Allowed types, max size messaging, file selection state.
 * Dependencies: Next.js dev server, Python worker.
 * Run time: ~30 sec.
 */
import { expect, test } from "@playwright/test";
import { ACCEPT_LABEL, FIXTURES, MAX_FILE_SIZE_MB } from "../../config/test-config";
import { buildUploadFilePayload } from "../../helpers/fixtures.helper";
import { gotoUploadPage } from "../../helpers/upload.helper";
import { createUploadPage } from "../../pages/upload.page";

test.describe.configure({ mode: "parallel" });

/**
 * Verifies validation messaging and selection state changes without uploading.
 *
 * WHY: Users must see correct limits before spending time on processing.
 * Pre-conditions: Health check ok, worker running.
 */
test("upload form validates file type and selection state", async ({ page }, testInfo) => {
  await gotoUploadPage(page);

  const uploadPage = createUploadPage(page);
  await expect(page.getByText(`Allowed: ${ACCEPT_LABEL}`)).toBeVisible();
  await expect(page.getByText(`Max file size: ${MAX_FILE_SIZE_MB} MB`)).toBeVisible();
  await expect(uploadPage.uploadButton).toBeDisabled();

  const { payload: unsupportedPayload } = await buildUploadFilePayload(
    FIXTURES.unsupportedFile,
    testInfo
  );
  await uploadPage.fileInput.setInputFiles(unsupportedPayload);
  await expect(uploadPage.uploadForm.getByRole("alert")).toContainText(
    `Unsupported file type. Allowed: ${ACCEPT_LABEL}.`
  );
  await expect(uploadPage.uploadButton).toBeDisabled();

  await uploadPage.clearSelectionButton.click();
  await expect(uploadPage.selectedFileSummary).toHaveCount(0);
  await expect(uploadPage.uploadButton).toBeDisabled();

  const { payload: goodPayload, fileName } = await buildUploadFilePayload(
    FIXTURES.goodPdf,
    testInfo
  );
  await uploadPage.fileInput.setInputFiles(goodPayload);
  await expect(uploadPage.selectedFileSummary).toContainText(fileName);
  await expect(uploadPage.uploadButton).toBeEnabled();
});
