import { NextResponse } from "next/server";
import { getMissingEnv, getResolvedRuntimeEnv } from "../../../lib/env";

export const runtime = "nodejs";

export async function GET() {
  const missingEnv = getMissingEnv();
  const resolved = getResolvedRuntimeEnv();
  const ok = missingEnv.length === 0;

  return NextResponse.json({
    ok,
    missingEnv,
    resolved
  });
}
