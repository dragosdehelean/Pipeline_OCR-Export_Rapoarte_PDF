/**
 * @fileoverview Validates PyMuPDF4LLM processing on a long PDF.
 *
 * Coverage: Engine override, long-document metrics, layout-only metadata.
 * Dependencies: Next.js dev server, Python worker with pymupdf-layout.
 * Run time: ~3 min.
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
 * Processes a long PDF with PyMuPDF4LLM and validates key metrics.
 *
 * WHY: Large documents are the common regression surface for layout-only runs.
 * Pre-conditions: PyMuPDF4LLM engine available.
 */
test("pymupdf4llm long_report reports expected metrics", async ({ page }, testInfo) => {
  // WHY: Processing can take up to the configured gate timeout.
  test.setTimeout(UPLOAD_TIMEOUT_MS * 2);
  await gotoUploadPage(page);

  const pymupdfAvailable = await isPymupdf4llmAvailable(page);
  test.skip(!pymupdfAvailable, "pymupdf4llm is not available in this environment.");

  const uploadPage = createUploadPage(page);
  const { payload } = await buildUploadFilePayload(FIXTURES.longReportPdf, testInfo);
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
    expect(meta.metrics?.pages).toBe(19);
    expect(meta.metrics?.textChars).toBeGreaterThan(1000);
    expect(meta.outputs?.markdownPath).toBeTruthy();
  }

  await deleteDoc(page, docId);
});
