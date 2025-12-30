import { defineConfig } from "@playwright/test";
import path from "node:path";

const rootDir = process.cwd();
const dataDir = process.env.DATA_DIR || path.join(rootDir, "data-test");
const gatesConfigPath =
  process.env.GATES_CONFIG_PATH || path.join(rootDir, "config", "quality-gates.json");
const doclingWorker =
  process.env.DOCLING_WORKER || path.join(rootDir, "fixtures", "worker", "fake_worker.py");
const pythonBin = process.env.PYTHON_BIN || "python";

process.env.DATA_DIR = dataDir;
process.env.GATES_CONFIG_PATH = gatesConfigPath;
process.env.DOCLING_WORKER = doclingWorker;
process.env.PYTHON_BIN = pythonBin;

export default defineConfig({
  testDir: "./playwright/tests",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATA_DIR: dataDir,
      GATES_CONFIG_PATH: gatesConfigPath,
      DOCLING_WORKER: doclingWorker,
      PYTHON_BIN: pythonBin
    }
  }
});
