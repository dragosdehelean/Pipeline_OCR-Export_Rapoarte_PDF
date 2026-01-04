/**
 * @fileoverview Health check helpers for E2E tests.
 */
import { expect, type Page } from "@playwright/test";
import { HEALTH_TIMEOUT_MS } from "../config/test-config";

export type HealthPayload = {
  ok?: boolean;
  config?: {
    accept?: {
      extensions?: string[];
      mimeTypes?: string[];
    };
    limits?: {
      maxFileSizeMb?: number;
      maxPages?: number;
      processTimeoutSec?: number;
    };
  } | null;
  docling?: {
    defaultProfile?: string;
    profiles?: string[];
  } | null;
  pymupdf?: {
    availability?: {
      pymupdf4llm?: {
        available?: boolean;
        reason?: string | null;
      };
    };
    engines?: string[];
    defaultEngine?: string;
  } | null;
};

/**
 * Waits for the health endpoint to respond and asserts readiness.
 */
export async function waitForHealthOk(page: Page): Promise<HealthPayload> {
  // WHY: Health readiness is required before upload controls unlock.
  const response = await page.waitForResponse(
    (res) => res.url().includes("/api/health"),
    { timeout: HEALTH_TIMEOUT_MS }
  );
  const payload = (await response.json().catch(() => null)) as HealthPayload | null;
  if (!payload?.ok) {
    throw new Error(`Health check failed: ${JSON.stringify(payload)}`);
  }
  return payload;
}

/**
 * Fetches the current health payload via Playwright request context.
 */
export async function fetchHealthPayload(page: Page): Promise<HealthPayload> {
  const response = await page.request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  return (await response.json().catch(() => null)) as HealthPayload;
}
