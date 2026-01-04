/**
 * @fileoverview Document API helpers for E2E tests.
 */
import { expect, type Page } from "@playwright/test";
import { UPLOAD_TIMEOUT_MS } from "../config/test-config";

type DocMeta = {
  processing?: {
    status?: string;
  };
  engine?: {
    effective?: {
      name?: string;
      layoutActive?: boolean;
    };
  };
  qualityGates?: {
    passed?: boolean;
  };
  metrics?: Record<string, number>;
  outputs?: {
    markdownPath?: string | null;
    jsonPath?: string | null;
  };
};

/**
 * Waits for document processing to finish and returns the terminal status.
 */
export async function waitForDocCompletion(page: Page, docId: string): Promise<string> {
  let finalStatus = "UNKNOWN";
  await expect.poll(
    async () => {
      const response = await page.request.get(`/api/docs/${docId}`);
      if (!response.ok()) {
        return "UNKNOWN";
      }
      const meta = (await response.json().catch(() => null)) as DocMeta | null;
      const status = meta?.processing?.status ?? "PENDING";
      if (status === "SUCCESS" || status === "FAILED") {
        finalStatus = status;
      }
      return status;
    },
    {
      // WHY: Gate processing timeouts define max wait for completion.
      timeout: UPLOAD_TIMEOUT_MS
    }
  ).toMatch(/SUCCESS|FAILED/);
  return finalStatus;
}

/**
 * Fetches and parses document metadata.
 */
export async function fetchDocMeta(page: Page, docId: string): Promise<DocMeta> {
  const response = await page.request.get(`/api/docs/${docId}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as DocMeta;
}

/**
 * Deletes a document and asserts the API response.
 */
export async function deleteDoc(page: Page, docId: string) {
  const response = await page.request.delete(`/api/docs/${docId}`);
  expect(response.ok()).toBeTruthy();
}
