/**
 * @fileoverview Returns meta.json for a single document id.
 */
import { NextResponse } from "next/server";
import { readMetaFile } from "../../../_lib/storage";

export const runtime = "nodejs";

/**
 * Serves the document meta.json or 404 if missing.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const meta = await readMetaFile(id);
    return NextResponse.json(meta);
  } catch (error) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
