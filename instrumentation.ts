/**
 * @fileoverview Next.js instrumentation hook to prewarm the Docling worker.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { prewarmDoclingWorker } = await import("./instrumentation-node");
  console.info("[worker] Prewarm started ...");
  prewarmDoclingWorker().catch((error) => {
    console.error("[worker] Prewarm failed", error);
  });
}

export const runtime = "nodejs";
