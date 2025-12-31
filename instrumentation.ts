/**
 * @fileoverview Next.js instrumentation hook to prewarm the Docling worker.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { prewarmDoclingWorker } = await import("./instrumentation-node");
  await prewarmDoclingWorker();
}

export const runtime = "nodejs";
