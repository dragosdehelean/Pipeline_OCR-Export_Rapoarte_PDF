/**
 * @fileoverview Validates export preview tabs and copy behavior.
 *
 * Coverage: Exports section links, preview tabs, copy UX.
 * Dependencies: Next.js dev server, Python worker.
 * Run time: ~2 min.
 */
import { expect, test } from "@playwright/test";
import { FIXTURES, UPLOAD_TIMEOUT_MS } from "../../config/test-config";
import { deleteDoc, waitForDocCompletion } from "../../helpers/docs.helper";
import { installClipboardMock, readClipboardText } from "../../helpers/clipboard.helper";
import { buildUploadFilePayload } from "../../helpers/fixtures.helper";
import { gotoUploadPage, uploadFileAndGetDocId } from "../../helpers/upload.helper";
import { createDocDetailsPage } from "../../pages/doc-details.page";
import { createUploadPage } from "../../pages/upload.page";

test.describe.configure({ mode: "parallel" });

/**
 * Uploads a document and verifies exports, preview tabs, and copy actions.
 *
 * WHY: Export previews are the main UX for verifying ingestion output.
 * Pre-conditions: Health check ok, worker running.
 */
test("export preview tabs allow copy for markdown and json", async ({ page }, testInfo) => {
  // WHY: Processing can take up to the configured gate timeout.
  test.setTimeout(UPLOAD_TIMEOUT_MS * 2);
  await installClipboardMock(page);
  await gotoUploadPage(page);

  const uploadPage = createUploadPage(page);
  const { payload } = await buildUploadFilePayload(FIXTURES.goodPdf, testInfo);
  const docId = await uploadFileAndGetDocId(page, payload);
  const status = await waitForDocCompletion(page, docId);
  expect(status).toBe("SUCCESS");

  await expect(uploadPage.statusRegion).toContainText("Processing complete");

  await page.goto(`/docs/${docId}`);

  const detailsPage = createDocDetailsPage(page);
  await expect(detailsPage.exportsHeading).toBeVisible();
  await expect(detailsPage.downloadMarkdownLink).toBeVisible();
  await expect(detailsPage.downloadJsonLink).toBeVisible();
  await expect(detailsPage.markdownTab).toBeVisible();
  await expect(detailsPage.jsonTab).toBeVisible();

  await expect(detailsPage.copyButton).toBeVisible();
  await detailsPage.copyButton.click();
  await expect(detailsPage.copiedButton).toBeVisible();
  const copiedMarkdown = await readClipboardText(page);
  expect(copiedMarkdown.trim().length).toBeGreaterThan(0);

  await detailsPage.jsonTab.click();
  await detailsPage.copyButton.click();
  const copiedJson = await readClipboardText(page);
  expect(copiedJson).toContain("\n  ");
  const parsedPreviewJson = JSON.parse(copiedJson);
  expect(Object.keys(parsedPreviewJson).length).toBeGreaterThan(0);

  await expect(detailsPage.previewContent).toBeVisible();
  const previewStyles = await detailsPage.previewContent.evaluate((node) => {
    const styles = getComputedStyle(node as HTMLElement);
    return { maxHeight: styles.maxHeight, overflowY: styles.overflowY };
  });
  expect(previewStyles.maxHeight).toBe("420px");
  expect(previewStyles.overflowY).toBe("auto");

  const hasHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(hasHorizontalScroll).toBeFalsy();

  await deleteDoc(page, docId);
});
