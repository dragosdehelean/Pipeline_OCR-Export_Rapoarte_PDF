import { NextResponse } from "next/server";
import { readMetaFile } from "../../../../lib/storage";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const meta = await readMetaFile(params.id);
    return NextResponse.json(meta);
  } catch (error) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
