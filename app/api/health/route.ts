import { NextResponse } from "next/server";
import { loadQualityGatesConfig } from "../../../lib/config";
import { getMissingEnv, getResolvedRuntimeEnv } from "../../../lib/env";

export const runtime = "nodejs";

export async function GET() {
  const missingEnv = getMissingEnv();
  const resolved = getResolvedRuntimeEnv();
  let config: { accept: unknown; limits: unknown } | null = null;
  let configError: string | null = null;

  if (missingEnv.length === 0) {
    try {
      const loaded = await loadQualityGatesConfig();
      config = {
        accept: loaded.accept,
        limits: {
          maxFileSizeMb: loaded.limits.maxFileSizeMb,
          maxPages: loaded.limits.maxPages,
          processTimeoutSec: loaded.limits.processTimeoutSec
        }
      };
    } catch (error) {
      configError = (error as Error).message || "Failed to load config.";
    }
  }

  const ok = missingEnv.length === 0 && !configError;

  return NextResponse.json({
    ok,
    missingEnv,
    resolved,
    config,
    configError
  });
}
