/**
 * @fileoverview Serves JSON export for a document.
 */
import fs from "node:fs/promises";
import { getJsonPath } from "../../../../_lib/storage";

export const runtime = "nodejs";

/**
 * Streams the JSON export for the requested document.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const raw = await fs.readFile(getJsonPath(id), "utf-8");
    let content = raw;
    try {
      content = `${JSON.stringify(JSON.parse(raw), null, 2)}\n`;
    } catch (error) {
      content = raw;
    }
    return new Response(content, {
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  } catch (error) {
    return new Response("Not found", { status: 404 });
  }
}
