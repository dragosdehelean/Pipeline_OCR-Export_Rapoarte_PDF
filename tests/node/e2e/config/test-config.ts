/**
 * @fileoverview Centralized constants and parsed quality gates config for E2E tests.
 */
import fs from "node:fs";
import path from "node:path";
import { qualityGatesSchema, type QualityGatesConfig } from "../../../../app/_lib/config";

export type FixtureFile = {
  path: string;
  baseName: string;
  extension: string;
  mimeType: string;
};

const rootDir = process.cwd();
const fixturesDir = path.join(rootDir, "tests", "fixtures", "docs");
const gatesConfigPath =
  process.env.GATES_CONFIG_PATH || path.join(rootDir, "config", "quality-gates.json");

export const FIXTURES: Record<string, FixtureFile> = {
  goodPdf: {
    path: path.join(fixturesDir, "one_page_report.pdf"),
    baseName: "one_page_report.pdf",
    extension: ".pdf",
    mimeType: "application/pdf"
  },
  badPdf: {
    path: path.join(fixturesDir, "scan_like_no_text.pdf"),
    baseName: "scan_like_no_text.pdf",
    extension: ".pdf",
    mimeType: "application/pdf"
  },
  longReportPdf: {
    path: path.join(fixturesDir, "long_report.pdf"),
    baseName: "long_report.pdf",
    extension: ".pdf",
    mimeType: "application/pdf"
  },
  unsupportedFile: {
    path: path.join(fixturesDir, "unsupported.txt"),
    baseName: "unsupported.txt",
    extension: ".txt",
    mimeType: "text/plain"
  }
};

export const GATES_CONFIG: QualityGatesConfig = qualityGatesSchema.parse(
  JSON.parse(fs.readFileSync(gatesConfigPath, "utf-8"))
);

export const ACCEPT_LABEL = Array.isArray(GATES_CONFIG.accept.extensions)
  ? GATES_CONFIG.accept.extensions.join(", ")
  : "";
export const MAX_FILE_SIZE_MB = Number(GATES_CONFIG.limits.maxFileSizeMb);
export const PROCESS_TIMEOUT_SEC = Number(GATES_CONFIG.limits.processTimeoutSec);
export const UPLOAD_TIMEOUT_MS = PROCESS_TIMEOUT_SEC * 1000;
export const HEALTH_TIMEOUT_MS = 30_000;

if (!Number.isFinite(PROCESS_TIMEOUT_SEC) || PROCESS_TIMEOUT_SEC <= 0) {
  throw new Error("Invalid limits.processTimeoutSec in quality-gates.json");
}

/**
 * Computes the minimum passing threshold for a metric based on FAIL gates.
 */
export function getMinRequiredForMetric(metric: string): number {
  let min = 0;
  for (const gate of GATES_CONFIG.gates ?? []) {
    if (!gate?.enabled || gate?.severity !== "FAIL" || gate?.metric !== metric) {
      continue;
    }
    const threshold = Number(gate?.threshold ?? 0);
    if (gate.op === ">") {
      min = Math.max(min, threshold + 1);
    } else if (gate.op === ">=" || gate.op === "==") {
      min = Math.max(min, threshold);
    } else if (gate.op === "!=") {
      min = Math.max(min, threshold + 1);
    }
  }
  return min;
}

export const MIN_TEXT_CHARS = getMinRequiredForMetric("textChars");
