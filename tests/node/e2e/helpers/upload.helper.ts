/**
 * @fileoverview Shared upload helpers for E2E tests.
 */
import { expect, type APIResponse, type FilePayload, type Page } from "@playwright/test";
import { UPLOAD_TIMEOUT_MS } from "../config/test-config";
import { createUploadPage } from "../pages/upload.page";
import { waitForHealthOk } from "./health.helper";

function extractDocId(payload: Record<string, unknown> | null): string {
  if (!payload) {
    return "";
  }
  const id = typeof payload.id === "string" ? payload.id : "";
  const docId = typeof payload.docId === "string" ? payload.docId : "";
  return id || docId;
}

/**
 * Navigates to the upload page and waits for health readiness.
 */
export async function gotoUploadPage(page: Page) {
  const uploadPage = createUploadPage(page);
  const healthPromise = waitForHealthOk(page);
  await page.goto("/");
  await healthPromise;
  await expect(uploadPage.fileInput).toBeVisible();
}

/**
 * Uploads a file and returns the raw upload API response.
 */
export async function uploadFile(
  page: Page,
  filePayload: FilePayload
): Promise<APIResponse> {
  const uploadPage = createUploadPage(page);
  // WHY: Respect the processing timeout from quality gates.
  const uploadResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/docs/upload") &&
      response.request().method() === "POST",
    { timeout: UPLOAD_TIMEOUT_MS }
  );
  await uploadPage.fileInput.setInputFiles(filePayload);
  await expect(uploadPage.uploadButton).toBeEnabled();
  await uploadPage.uploadButton.click();
  return uploadResponsePromise;
}

/**
 * Submits an upload when the file input is already populated.
 */
export async function submitUpload(page: Page): Promise<APIResponse> {
  const uploadPage = createUploadPage(page);
  // WHY: Respect the processing timeout from quality gates.
  const uploadResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/docs/upload") &&
      response.request().method() === "POST",
    { timeout: UPLOAD_TIMEOUT_MS }
  );
  await expect(uploadPage.uploadButton).toBeEnabled();
  await uploadPage.uploadButton.click();
  return uploadResponsePromise;
}

/**
 * Submits an upload and returns the parsed document id.
 */
export async function submitUploadAndGetDocId(page: Page): Promise<string> {
  const response = await submitUpload(page);
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const docId = extractDocId(payload);
  if (!docId) {
    throw new Error("Upload response missing document id.");
  }
  return docId;
}

/**
 * Uploads a file and returns the parsed document id.
 */
export async function uploadFileAndGetDocId(
  page: Page,
  filePayload: FilePayload
): Promise<string> {
  const response = await uploadFile(page, filePayload);
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const docId = extractDocId(payload);
  if (!docId) {
    throw new Error("Upload response missing document id.");
  }
  return docId;
}
