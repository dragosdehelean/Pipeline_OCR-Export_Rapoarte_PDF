/**
 * @fileoverview Verifies health readiness for the upload UI.
 *
 * Coverage: /api/health readiness gate.
 * Dependencies: Next.js dev server, Python worker.
 * Run time: ~10 sec.
 */
import { expect, test } from "@playwright/test";
import { fetchHealthPayload } from "../../helpers/health.helper";

test.describe.configure({ mode: "parallel" });

test("health check reports ok=true", async ({ page }) => {
  await page.goto("/");

  const payload = await fetchHealthPayload(page);
  expect(payload.ok).toBe(true);
});
