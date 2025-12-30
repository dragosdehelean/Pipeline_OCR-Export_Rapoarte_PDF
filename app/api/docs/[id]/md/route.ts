import fs from "node:fs/promises";
import { getMarkdownPath } from "../../../../_lib/storage";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const { id } = await Promise.resolve(params);
    const content = await fs.readFile(getMarkdownPath(id), "utf-8");
    return new Response(content, {
      headers: { "content-type": "text/markdown; charset=utf-8" }
    });
  } catch (error) {
    return new Response("Not found", { status: 404 });
  }
}
