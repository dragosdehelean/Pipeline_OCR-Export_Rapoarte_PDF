import { docMetaSchema, Metrics, type DocMeta, type FailedGate } from "./schema";

export function toDocMeta(meta: Record<string, unknown>): DocMeta {
  const metrics = normalizeMetrics(meta);
  const failedGates = normalizeFailedGates(meta);
  const logs = normalizeLogs(meta);
  const status = resolveStatus(meta, failedGates);
  const raw = {
    id: String(meta.id ?? ""),
    originalFileName: String((meta.source as any)?.originalFileName ?? ""),
    mimeType: String((meta.source as any)?.mimeType ?? ""),
    createdAt: String(meta.createdAt ?? ""),
    status,
    metrics,
    failedGates,
    logs
  };

  return docMetaSchema.parse(raw);
}

export function resolveStatus(
  meta: Record<string, unknown>,
  failedGates: FailedGate[]
): DocMeta["status"] {
  const processingStatus = String((meta.processing as any)?.status ?? "PENDING");
  const outputs = (meta.outputs as any) ?? {};
  const hasOutputs = Boolean(outputs.markdownPath) && Boolean(outputs.jsonPath);

  if (processingStatus === "PENDING") {
    return "PENDING";
  }

  if (failedGates.length > 0) {
    return "FAILED";
  }

  if (processingStatus !== "SUCCESS") {
    return "FAILED";
  }

  if (!hasOutputs) {
    return "FAILED";
  }

  return "SUCCESS";
}

function normalizeMetrics(meta: Record<string, unknown>): Metrics {
  const metrics = (meta.metrics as any) ?? {};
  return {
    pages: Number(metrics.pages ?? 0),
    textChars: Number(metrics.textChars ?? 0),
    mdChars: Number(metrics.mdChars ?? 0),
    textItems: Number(metrics.textItems ?? 0),
    tables: Number(metrics.tables ?? 0),
    textCharsPerPageAvg: Number(metrics.textCharsPerPageAvg ?? 0)
  };
}

function normalizeFailedGates(meta: Record<string, unknown>): FailedGate[] {
  const gates = (meta.qualityGates as any)?.failedGates ?? [];
  if (!Array.isArray(gates)) {
    return [];
  }
  return gates.map((gate) => ({
    code: String(gate.code ?? ""),
    message: String(gate.message ?? ""),
    actual: Number(gate.actual ?? 0),
    expectedOp: String(gate.expectedOp ?? ""),
    expected: Number(gate.expected ?? 0)
  }));
}

function normalizeLogs(meta: Record<string, unknown>): { stdoutTail: string; stderrTail: string } {
  const logs = (meta.logs as any) ?? {};
  return {
    stdoutTail: String(logs.stdoutTail ?? ""),
    stderrTail: String(logs.stderrTail ?? "")
  };
}
