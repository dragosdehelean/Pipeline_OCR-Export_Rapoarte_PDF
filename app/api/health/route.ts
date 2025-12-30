/**
 * @fileoverview Health endpoint for env readiness and gate config preview.
 */
import { NextResponse } from "next/server";
import { loadQualityGatesConfig, type QualityGatesConfig } from "../../_lib/config";
import { getMissingEnv, getResolvedRuntimeEnv } from "../../_lib/env";

export const runtime = "nodejs";

type HealthResponse = {
  ok: boolean;
  missingEnv: string[];
  resolved: ReturnType<typeof getResolvedRuntimeEnv>;
  config: Pick<QualityGatesConfig, "accept" | "limits"> | null;
  configError: string | null;
};

/**
 * Returns readiness info for UI gating and setup checks.
 */
export async function GET() {
  const missingEnv = getMissingEnv();
  const resolved = getResolvedRuntimeEnv();
  let config: Pick<QualityGatesConfig, "accept" | "limits"> | null = null;
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

  return NextResponse.json<HealthResponse>({
    ok,
    missingEnv,
    resolved,
    config,
    configError
  });
}
