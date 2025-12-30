/**
 * @fileoverview Playwright global setup for cleaning test data.
 */
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Clears the E2E data directory before the test run.
 */
export default async function globalSetup() {
  const dataDir =
    process.env.DATA_DIR ||
    path.join(process.cwd(), "tests", "node", "e2e", "data-test");
  await fs.rm(dataDir, { recursive: true, force: true });
}
