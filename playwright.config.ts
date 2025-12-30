/**
 * @fileoverview Playwright config for the local E2E test suite.
 */
import { defineConfig } from "@playwright/test";
import path from "node:path";

const rootDir = process.cwd();
const dataDir =
  process.env.DATA_DIR || path.join(rootDir, "tests", "node", "e2e", "data-test");
const gatesConfigPath =
  process.env.GATES_CONFIG_PATH || path.join(rootDir, "config", "quality-gates.json");
const doclingWorker =
  process.env.DOCLING_WORKER ||
  path.join(rootDir, "tests", "fixtures", "worker", "fake_worker.py");
const pythonBin = process.env.PYTHON_BIN || "python";
const e2ePort = Number(process.env.E2E_PORT || "3001");
const externalBaseUrl = process.env.E2E_BASE_URL;
const baseURL = externalBaseUrl ?? `http://127.0.0.1:${e2ePort}`;
const e2eDistDir = process.env.E2E_DIST_DIR || ".next-e2e";

// WHY: Force deterministic env defaults for the E2E worker fixtures.
process.env.DATA_DIR = dataDir;
process.env.GATES_CONFIG_PATH = gatesConfigPath;
process.env.DOCLING_WORKER = doclingWorker;
process.env.PYTHON_BIN = pythonBin;

export default defineConfig({
  testDir: "./tests/node/e2e",
  testIgnore: ["**/ux-heuristics-audit.spec.ts"],
  outputDir: "./tests/node/e2e/test-results",
  timeout: 60_000,
  use: {
    baseURL,
    trace: "retain-on-failure"
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        // WHY: Only start a dev server when not targeting an existing instance.
        command: `npm run dev -- --hostname 127.0.0.1 --port ${e2ePort} --webpack`,
        url: `http://127.0.0.1:${e2ePort}`,
        reuseExistingServer: true,
        timeout: 120_000,
        env: {
          DATA_DIR: dataDir,
          GATES_CONFIG_PATH: gatesConfigPath,
          DOCLING_WORKER: doclingWorker,
          PYTHON_BIN: pythonBin,
          NEXT_DIST_DIR: e2eDistDir
        }
      },
  globalSetup: "./tests/node/e2e/global-setup.ts"
});
