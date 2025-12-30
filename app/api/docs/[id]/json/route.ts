import fs from "node:fs/promises";
import { getJsonPath } from "../../../../_lib/storage";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const { id } = await Promise.resolve(params);
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
