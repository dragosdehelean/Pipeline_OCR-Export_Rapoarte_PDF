import { NextResponse } from "next/server";
import { listDocs } from "../../../lib/storage";
import type { DocMeta } from "../../../lib/schema";

export const runtime = "nodejs";

export async function GET() {
  const docs = await listDocs(50);
  return NextResponse.json<{ docs: DocMeta[] }>({ docs });
}
