import fs from "fs/promises";
import { getMarkdownPath } from "../../../../../lib/storage";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const content = await fs.readFile(getMarkdownPath(params.id), "utf-8");
    return new Response(content, {
      headers: { "content-type": "text/markdown; charset=utf-8" }
    });
  } catch (error) {
    return new Response("Not found", { status: 404 });
  }
}
