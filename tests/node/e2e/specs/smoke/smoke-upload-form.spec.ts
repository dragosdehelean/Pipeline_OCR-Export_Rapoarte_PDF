/**
 * @fileoverview Ensures the upload form renders in a ready state.
 *
 * Coverage: Upload form inputs and default disabled state.
 * Dependencies: Next.js dev server, Python worker.
 * Run time: ~20 sec.
 */
import { expect, test } from "@playwright/test";
import { gotoUploadPage } from "../../helpers/upload.helper";
import { createUploadPage } from "../../pages/upload.page";

test.describe.configure({ mode: "parallel" });

test("upload form renders with disabled submit", async ({ page }) => {
  await gotoUploadPage(page);

  const uploadPage = createUploadPage(page);
  await expect(uploadPage.fileInput).toBeVisible();
  await expect(uploadPage.uploadButton).toBeDisabled();
});
