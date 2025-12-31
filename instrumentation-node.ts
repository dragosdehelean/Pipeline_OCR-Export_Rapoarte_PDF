/**
 * @fileoverview Node-only bootstrapping for the Docling worker process.
 */
import { getMissingEnv, getResolvedRuntimeEnv } from "./app/_lib/env";
import {
  getWorkerStatus,
  prewarmWorker
} from "./app/_lib/workerClient";

export async function prewarmDoclingWorker() {
  const missingEnv = getMissingEnv();
  if (missingEnv.length > 0) {
    console.warn(
      `[worker] Prewarm skipped; missing env: ${missingEnv.join(", ")}.`
    );
    return;
  }

  const resolved = getResolvedRuntimeEnv();
  if (!resolved.PYTHON_BIN || !resolved.DOCLING_WORKER) {
    console.warn("[worker] Prewarm skipped; PYTHON_BIN/DOCLING_WORKER missing.");
    return;
  }

  try {
    await prewarmWorker({
      pythonBin: resolved.PYTHON_BIN,
      workerPath: resolved.DOCLING_WORKER,
      timeoutMs: 30000
    });
    const status = getWorkerStatus();
    const prewarm = status.prewarm;
    if (prewarm) {
      console.info(
        `[worker] Prewarm ready (profile=${prewarm.profile}, requested=${prewarm.requestedDevice}, effective=${prewarm.effectiveDevice}).`
      );
    } else {
      console.info(
        "[worker] Prewarm ready."
      );
    }
  } catch (error) {
    console.warn(`[worker] Prewarm failed: ${(error as Error).message}`);
  }
}
