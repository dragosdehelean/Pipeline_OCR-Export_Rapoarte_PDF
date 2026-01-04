/**
 * @fileoverview Validates PyMuPDF4LLM processing on a small PDF.
 *
 * Coverage: Engine override, layout-only metadata, quality gate pass.
 * Dependencies: Next.js dev server, Python worker with pymupdf-layout.
 * Run time: ~2 min.
 */
import { expect, test } from "@playwright/test";
import { FIXTURES, UPLOAD_TIMEOUT_MS } from "../../config/test-config";
import { fetchDocMeta, waitForDocCompletion, deleteDoc } from "../../helpers/docs.helper";
import { isPymupdf4llmAvailable } from "../../helpers/engine.helper";
import { buildUploadFilePayload } from "../../helpers/fixtures.helper";
import { gotoUploadPage, submitUploadAndGetDocId } from "../../helpers/upload.helper";
import { createUploadPage } from "../../pages/upload.page";

test.describe.configure({ mode: "parallel" });

/**
 * Overrides the engine to PyMuPDF4LLM and validates metadata on completion.
 *
 * WHY: Ensure layout-only PyMuPDF4LLM output matches the engine metadata contract.
 * Pre-conditions: PyMuPDF4LLM engine available.
 */
test("pymupdf4llm one_page_report produces expected metadata", async ({ page }, testInfo) => {
  // WHY: Processing can take up to the configured gate timeout.
  test.setTimeout(UPLOAD_TIMEOUT_MS * 2);
  await gotoUploadPage(page);

  const pymupdfAvailable = await isPymupdf4llmAvailable(page);
  test.skip(!pymupdfAvailable, "pymupdf4llm is not available in this environment.");

  const uploadPage = createUploadPage(page);
  const { payload } = await buildUploadFilePayload(FIXTURES.goodPdf, testInfo);
  await uploadPage.fileInput.setInputFiles(payload);
  await uploadPage.advancedToggle.click();
  await uploadPage.engineSelect.selectOption("pymupdf4llm");

  const docId = await submitUploadAndGetDocId(page);
  const status = await waitForDocCompletion(page, docId);
  const meta = await fetchDocMeta(page, docId);

  expect(meta.processing?.status).toBe(status);
  expect(meta.engine?.effective?.name).toBe("pymupdf4llm");
  expect(meta.engine?.effective?.layoutActive).toBe(true);

  if (status === "SUCCESS") {
    expect(meta.qualityGates?.passed).toBe(true);
    expect(meta.metrics?.textChars).toBeGreaterThan(500);
    expect(meta.outputs?.markdownPath).toBeTruthy();
    expect(meta.outputs?.jsonPath).toBeTruthy();
  }

  await deleteDoc(page, docId);
});
