import {
  docMetaSchema,
  type DocMeta,
  type FailedGate,
  type MetaFile,
  type Metrics
} from "./schema";

export function toDocMeta(meta: MetaFile): DocMeta {
  const metrics = normalizeMetrics(meta.metrics);
  const failedGates = normalizeFailedGates(meta.qualityGates.failedGates);
  const logs = normalizeLogs(meta.logs);
  const status = resolveStatus(meta, failedGates);
  const raw = {
    id: meta.id ?? "",
    originalFileName: meta.source?.originalFileName ?? "",
    mimeType: meta.source?.mimeType ?? "",
    createdAt: meta.createdAt ?? "",
    status,
    metrics,
    failedGates,
    logs
  };

  return docMetaSchema.parse(raw);
}

export function resolveStatus(meta: MetaFile, failedGates: FailedGate[]): DocMeta["status"] {
  const processingStatus = meta.processing.status ?? "PENDING";
  const hasOutputs = Boolean(meta.outputs.markdownPath) && Boolean(meta.outputs.jsonPath);

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

function normalizeMetrics(metrics: Metrics): Metrics {
  return {
    pages: Number.isFinite(metrics.pages) ? metrics.pages : 0,
    textChars: Number.isFinite(metrics.textChars) ? metrics.textChars : 0,
    mdChars: Number.isFinite(metrics.mdChars) ? metrics.mdChars : 0,
    textItems: Number.isFinite(metrics.textItems) ? metrics.textItems : 0,
    tables: Number.isFinite(metrics.tables) ? metrics.tables : 0,
    textCharsPerPageAvg: Number.isFinite(metrics.textCharsPerPageAvg)
      ? metrics.textCharsPerPageAvg
      : 0
  };
}

function normalizeFailedGates(gates: FailedGate[]): FailedGate[] {
  return gates.map((gate) => ({
    code: gate.code ?? "",
    message: gate.message ?? "",
    actual: Number.isFinite(gate.actual) ? gate.actual : 0,
    expectedOp: gate.expectedOp ?? "",
    expected: Number.isFinite(gate.expected) ? gate.expected : 0
  }));
}

function normalizeLogs(logs: MetaFile["logs"]): { stdoutTail: string; stderrTail: string } {
  return {
    stdoutTail: logs.stdoutTail ?? "",
    stderrTail: logs.stderrTail ?? ""
  };
}
