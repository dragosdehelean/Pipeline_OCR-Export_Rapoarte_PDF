import { NextResponse } from "next/server";
import { readMetaFile } from "../../../_lib/storage";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const { id } = await Promise.resolve(params);
    const meta = await readMetaFile(id);
    return NextResponse.json(meta);
  } catch (error) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
