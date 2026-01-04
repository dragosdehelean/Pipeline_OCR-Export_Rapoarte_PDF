/**
 * @fileoverview Runs uploads across all Docling profiles.
 *
 * Coverage: Docling profile overrides across all configured profiles.
 * Dependencies: Next.js dev server, Python worker.
 * Run time: ~5-10 min.
 */
import { expect, test } from "@playwright/test";
import { FIXTURES, UPLOAD_TIMEOUT_MS } from "../../config/test-config";
import { deleteDoc, waitForDocCompletion } from "../../helpers/docs.helper";
import { buildUploadFilePayload } from "../../helpers/fixtures.helper";
import { gotoUploadPage, submitUploadAndGetDocId } from "../../helpers/upload.helper";
import { createUploadPage } from "../../pages/upload.page";

test.describe.configure({ mode: "parallel" });

/**
 * @slow ~5-10 minutes
 * WHY SLOW: Iterates through every Docling profile with real processing.
 * WHEN TO RUN: Nightly or pre-release validation.
 *
 * WHY: Ensure every configured profile stays green after pipeline changes.
 * Pre-conditions: Docling profiles configured in /api/health.
 */
test("uploading each docling profile succeeds @slow", async ({ page }, testInfo) => {
  test.slow();
  // WHY: Multiple profiles extend the total processing time.
  test.setTimeout(UPLOAD_TIMEOUT_MS * 6);
  await gotoUploadPage(page);

  const uploadPage = createUploadPage(page);
  await uploadPage.advancedToggle.click();
  await expect(uploadPage.profileSelect).toBeVisible();

  const profiles = (
    await uploadPage.profileSelect
      .getByRole("option")
      .evaluateAll((options) =>
        options.map((option) => option.getAttribute("value") ?? "")
      )
  ).filter(Boolean);

  for (const profile of profiles) {
    const { payload } = await buildUploadFilePayload(
      FIXTURES.goodPdf,
      testInfo,
      `docling-${profile}.pdf`
    );
    await uploadPage.fileInput.setInputFiles(payload);
    if (!(await uploadPage.profileSelect.isVisible())) {
      await uploadPage.advancedToggle.click();
    }
    await expect(uploadPage.profileSelect).toBeVisible();
    await uploadPage.profileSelect.selectOption(profile);

    const docId = await submitUploadAndGetDocId(page);
    const status = await waitForDocCompletion(page, docId);
    expect(status).toBe("SUCCESS");
    await deleteDoc(page, docId);
  }
});
