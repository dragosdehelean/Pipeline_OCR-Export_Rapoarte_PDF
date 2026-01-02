/**
 * @fileoverview Playwright config for UX audit screenshot runs.
 */
import { defineConfig } from "@playwright/test";
import path from "node:path";

const rootDir = process.cwd();
const auditDir = path.join(rootDir, "tests", "node", "e2e", "ux-audit");
const dataDir =
  process.env.DATA_DIR || path.join(rootDir, "tests", "node", "e2e", "data-test");
const gatesConfigPath =
  process.env.GATES_CONFIG_PATH || path.join(rootDir, "config", "quality-gates.json");
const doclingWorker =
  process.env.DOCLING_WORKER ||
  path.join(rootDir, "services", "docling_worker", "convert.py");
const pythonBin = process.env.PYTHON_BIN || "python";
const auditPort = Number(process.env.UX_AUDIT_PORT || "3000");
const externalBaseUrl = process.env.UX_AUDIT_BASE_URL;
const baseURL = externalBaseUrl ?? `http://127.0.0.1:${auditPort}`;
const auditDistDir = process.env.UX_AUDIT_DIST_DIR || ".next-ux-audit";

// WHY: Force deterministic env defaults for UX audit runs.
process.env.DATA_DIR = dataDir;
process.env.GATES_CONFIG_PATH = gatesConfigPath;
process.env.DOCLING_WORKER = doclingWorker;
process.env.PYTHON_BIN = pythonBin;

export default defineConfig({
  testDir: auditDir,
  testMatch: "**/*.spec.ts",
  outputDir: path.join(auditDir, "test-results"),
  timeout: 60_000,
  use: {
    baseURL,
    trace: "retain-on-failure"
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        // WHY: Only start a dev server when not targeting an existing instance.
        command: `npm run dev -- --hostname 127.0.0.1 --port ${auditPort} --webpack`,
        url: `http://127.0.0.1:${auditPort}`,
        reuseExistingServer: true,
        timeout: 120_000,
        env: {
          DATA_DIR: dataDir,
          GATES_CONFIG_PATH: gatesConfigPath,
          DOCLING_WORKER: doclingWorker,
          PYTHON_BIN: pythonBin,
          NEXT_DIST_DIR: auditDistDir
        }
      }
});
