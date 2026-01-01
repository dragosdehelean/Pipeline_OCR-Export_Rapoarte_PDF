/**
 * @fileoverview Health endpoint for env readiness and gate config preview.
 */
import { NextResponse } from "next/server";
import {
  loadDoclingConfig,
  loadQualityGatesConfig,
  type QualityGatesConfig
} from "../../_lib/config";
import { getMissingEnv, getResolvedRuntimeEnv } from "../../_lib/env";
import { getWorkerStatus, type WorkerStatusSnapshot } from "../../_lib/workerClient";

export const runtime = "nodejs";

type HealthResponse = {
  ok: boolean;
  missingEnv: string[];
  resolved: ReturnType<typeof getResolvedRuntimeEnv>;
  worker: WorkerStatusSnapshot;
  docling: {
    defaultProfile: string;
    profiles: string[];
  } | null;
  config: {
    accept: QualityGatesConfig["accept"];
    limits: Pick<
      QualityGatesConfig["limits"],
      "maxFileSizeMb" | "maxPages" | "processTimeoutSec"
    >;
  } | null;
  configError: string | null;
  doclingConfigError: string | null;
};

type HealthConfig = NonNullable<HealthResponse["config"]>;

/**
 * Returns readiness info for UI gating and setup checks.
 */
export async function GET() {
  const missingEnv = getMissingEnv();
  const resolved = getResolvedRuntimeEnv();
  const worker = getWorkerStatus();
  let config: HealthConfig | null = null;
  let configError: string | null = null;
  let docling: HealthResponse["docling"] = null;
  let doclingConfigError: string | null = null;

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
    try {
      const doclingConfig = await loadDoclingConfig();
      docling = {
        defaultProfile: doclingConfig.defaultProfile,
        profiles: Object.keys(doclingConfig.profiles)
      };
    } catch (error) {
      doclingConfigError =
        (error as Error).message || "Failed to load docling config.";
    }
  }

  const ok = missingEnv.length === 0 && !configError && !doclingConfigError;

  return NextResponse.json<HealthResponse>({
    ok,
    missingEnv,
    resolved,
    worker,
    docling,
    config,
    configError,
    doclingConfigError
  });
}
