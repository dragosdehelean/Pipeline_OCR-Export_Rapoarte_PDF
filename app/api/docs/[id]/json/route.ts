import fs from "fs/promises";
import { getJsonPath } from "../../../../../lib/storage";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const content = await fs.readFile(getJsonPath(params.id), "utf-8");
    return new Response(content, {
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  } catch (error) {
    return new Response("Not found", { status: 404 });
  }
}
