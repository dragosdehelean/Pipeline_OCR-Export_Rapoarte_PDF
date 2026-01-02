/**
 * @fileoverview Health endpoint for env readiness and gate config preview.
 */
import { NextResponse } from "next/server";
import {
  loadDoclingConfig,
  loadPyMuPDFConfig,
  loadQualityGatesConfig,
  type QualityGatesConfig
} from "../../_lib/config";
import { getMissingEnv, getResolvedRuntimeEnv } from "../../_lib/env";
import {
  getWorkerCapabilities,
  getWorkerStatus,
  type DoclingWorkerSnapshot,
  type WorkerStatusSnapshot
} from "../../_lib/workerClient";

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
  pymupdf: {
    engines: string[];
    defaultEngine: string;
    layoutModeDefault?: "layout" | "standard";
    availability?: {
      pymupdf4llm: { available: boolean; reason?: string | null };
      layout: { available: boolean; reason?: string | null };
    };
    configError?: string;
  } | null;
  doclingWorker: DoclingWorkerSnapshot | null;
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
type PyMuPDFAvailability = NonNullable<HealthResponse["pymupdf"]>["availability"];

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
  let pymupdf: HealthResponse["pymupdf"] = null;
  let doclingConfigError: string | null = null;
  let doclingWorker: DoclingWorkerSnapshot | null = null;
  let pymupdfAvailability: PyMuPDFAvailability | null = null;

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
    try {
      const pymupdfConfig = await loadPyMuPDFConfig();
      pymupdf = {
        engines: pymupdfConfig.engines,
        defaultEngine: pymupdfConfig.defaultEngine,
        layoutModeDefault: pymupdfConfig.pymupdf4llm.layoutModeDefault
      };
    } catch (error) {
      pymupdf = {
        engines: [],
        defaultEngine: "docling",
        configError:
          (error as Error).message || "Failed to load pymupdf config."
      };
    }

    const pythonBin = process.env.PYTHON_BIN ?? "";
    const workerPath = process.env.DOCLING_WORKER ?? "";
    if (pythonBin && workerPath) {
      doclingWorker = await getWorkerCapabilities({
        pythonBin,
        workerPath
      });
    }
    pymupdfAvailability = buildPyMuPDFAvailability(doclingWorker);
  }

  const ok = missingEnv.length === 0 && !configError && !doclingConfigError;

  return NextResponse.json<HealthResponse>({
    ok,
    missingEnv,
    resolved,
    worker,
    docling,
    pymupdf: pymupdf
      ? {
          ...pymupdf,
          availability: pymupdfAvailability ?? undefined
        }
      : null,
    doclingWorker,
    config,
    configError,
    doclingConfigError
  });
}

function buildPyMuPDFAvailability(
  worker: DoclingWorkerSnapshot | null
): PyMuPDFAvailability | null {
  const availability = worker?.capabilities?.pymupdf ?? null;
  if (!availability) {
    return {
      pymupdf4llm: { available: false, reason: "WORKER_CAPABILITIES_UNAVAILABLE" },
      layout: { available: false, reason: "WORKER_CAPABILITIES_UNAVAILABLE" }
    };
  }
  return {
    pymupdf4llm: {
      available: availability.pymupdf4llm.available,
      reason: availability.pymupdf4llm.reason ?? null
    },
    layout: {
      available: availability.layout.available,
      reason: availability.layout.reason ?? null
    }
  };
}
