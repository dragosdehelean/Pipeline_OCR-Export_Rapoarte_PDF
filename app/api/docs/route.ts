/**
 * @fileoverview List docs endpoint for recent document summaries.
 */
import { NextResponse } from "next/server";
import { listDocs } from "../../_lib/storage";
import type { DocMeta } from "../../_lib/schema";

export const runtime = "nodejs";

/**
 * Returns recent document summaries for the UI.
 */
export async function GET() {
  const docs = await listDocs(50);
  return NextResponse.json<{ docs: DocMeta[] }>({ docs });
}
