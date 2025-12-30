/**
 * @fileoverview Serves markdown export for a document.
 */
import fs from "node:fs/promises";
import { getMarkdownPath } from "../../../../_lib/storage";

export const runtime = "nodejs";

/**
 * Streams the markdown export for the requested document.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const content = await fs.readFile(getMarkdownPath(id), "utf-8");
    return new Response(content, {
      headers: { "content-type": "text/markdown; charset=utf-8" }
    });
  } catch (error) {
    return new Response("Not found", { status: 404 });
  }
}
