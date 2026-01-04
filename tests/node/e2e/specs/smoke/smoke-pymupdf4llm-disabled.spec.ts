/**
 * @fileoverview Checks UI behavior when PyMuPDF4LLM is unavailable.
 *
 * Coverage: Engine selector availability gating.
 * Dependencies: Next.js dev server, Python worker.
 * Run time: ~30 sec.
 */
import { expect, test } from "@playwright/test";
import { FIXTURES } from "../../config/test-config";
import { buildUploadFilePayload } from "../../helpers/fixtures.helper";
import { gotoUploadPage } from "../../helpers/upload.helper";
import { createUploadPage } from "../../pages/upload.page";

test.describe.configure({ mode: "parallel" });

/**
 * Ensures the engine selector disables PyMuPDF4LLM when health reports it missing.
 *
 * WHY: Avoid users selecting an engine that cannot run in the current environment.
 * Pre-conditions: Health endpoint must be reachable.
 */
test("engine selector disables pymupdf4llm when deps missing", async ({ page }, testInfo) => {
  // WHY: Override health payload to simulate missing PyMuPDF4LLM deps.
  await page.route("**/api/health", async (route) => {
    const response = await route.fetch();
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object") {
      return route.fulfill({ response });
    }
    const nextPayload = {
      ...payload,
      pymupdf: payload.pymupdf
        ? {
            ...(payload.pymupdf as Record<string, unknown>),
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

  await gotoUploadPage(page);

  const uploadPage = createUploadPage(page);
  const { payload } = await buildUploadFilePayload(FIXTURES.goodPdf, testInfo);
  await uploadPage.fileInput.setInputFiles(payload);
  await uploadPage.advancedToggle.click();

  await expect(uploadPage.engineSelect).toBeEnabled();
  await expect(
    uploadPage.engineSelect.getByRole("option", { name: "PyMuPDF4LLM" })
  ).toBeDisabled();
  await expect(uploadPage.engineSelect).toHaveValue("docling");
});
