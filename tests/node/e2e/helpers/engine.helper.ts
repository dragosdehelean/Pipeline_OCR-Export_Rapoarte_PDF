/**
 * @fileoverview Engine availability helpers for E2E tests.
 */
import type { Page } from "@playwright/test";
import { fetchHealthPayload } from "./health.helper";

/**
 * Reports whether PyMuPDF4LLM is available according to health status.
 */
export async function isPymupdf4llmAvailable(page: Page): Promise<boolean> {
  const payload = await fetchHealthPayload(page);
  return payload.pymupdf?.availability?.pymupdf4llm?.available === true;
}
