/**
 * @fileoverview Builds deterministic upload payloads for Playwright file inputs.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { FilePayload, TestInfo } from "@playwright/test";
import type { FixtureFile } from "../config/test-config";

type UploadPayload = {
  payload: FilePayload;
  fileName: string;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Builds a FilePayload with a deterministic name for isolation across tests.
 */
export async function buildUploadFilePayload(
  fixture: FixtureFile,
  testInfo: TestInfo,
  overrideName?: string
): Promise<UploadPayload> {
  const buffer = await fs.readFile(fixture.path);
  const stemSource = overrideName
    ? path.basename(overrideName, fixture.extension)
    : testInfo.titlePath.join(" ");
  const safeStem = slugify(stemSource) || path.basename(fixture.baseName, fixture.extension);
  const uniqueToken = `${testInfo.workerIndex}-${testInfo.repeatEachIndex}`;
  const fileName = overrideName
    ? overrideName
    : `${safeStem}-${uniqueToken}${fixture.extension}`;

  return {
    payload: {
      name: fileName,
      mimeType: fixture.mimeType,
      buffer
    },
    fileName
  };
}
