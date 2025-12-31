/**
 * @fileoverview Upload endpoint that spawns the Docling worker and tracks progress.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import {
  getDoclingConfigPath,
  getGatesConfigPath,
  loadQualityGatesConfig,
  type QualityGatesConfig
} from "../../../_lib/config";
import { getMissingEnv } from "../../../_lib/env";
import {
  ensureDataDirs,
  getDataDir,
  getDocExportDir,
  getMetaPath,
  getProgressPath,
  getUploadPath,
  upsertIndexDoc,
  writeJsonAtomic
} from "../../../_lib/storage";
import {
  submitWorkerJob,
  type WorkerJobResult,
  type WorkerProgressUpdate,
  WorkerJobError
} from "../../../_lib/workerClient";
import { toDocMeta } from "../../../_lib/meta";
import { metaFileSchema, type DocStatus, type MetaFile } from "../../../_lib/schema";
import { generateDocId, getFileExtension } from "../../../_lib/utils";

export const runtime = "nodejs";

/**
 * Accepts an upload, validates gates, and kicks off worker processing.
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const missingEnv = getMissingEnv();
  if (missingEnv.length > 0) {
    return jsonError({
      status: 500,
      stage: "SETUP",
      message: "Setup required.",
      requestId,
      code: "MISSING_ENV",
      missingEnv
    });
  }

  let config: QualityGatesConfig;
  try {
    config = await loadQualityGatesConfig();
  } catch (error) {
    return jsonError({
      status: 500,
      stage: "CONFIG",
      message: (error as Error).message || "Failed to load quality gate config.",
      requestId
    });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (error) {
    return jsonError({
      status: 400,
      stage: "UPLOAD",
      message: "Unable to read the upload form payload.",
      requestId
    });
  }

  const file = formData.get("file");
  const deviceOverride = parseDeviceOverride(formData.get("deviceOverride"));

  if (!isFileLike(file)) {
    return jsonError({
      status: 400,
      stage: "VALIDATION",
      message: "Missing file upload.",
      requestId
    });
  }

  const mimeType = file.type;
  const extension = resolveExtension(getFileExtension(file.name), mimeType);

  if (!config.accept.mimeTypes.includes(mimeType)) {
    return jsonError({
      status: 400,
      stage: "VALIDATION",
      message: "Unsupported mime type.",
      requestId
    });
  }

  if (!extension || !config.accept.extensions.includes(extension)) {
    return jsonError({
      status: 400,
      stage: "VALIDATION",
      message: "Unsupported file extension.",
      requestId
    });
  }

  const maxBytes = config.limits.maxFileSizeMb * 1024 * 1024;
  if (file.size > maxBytes) {
    return jsonError({
      status: 413,
      stage: "VALIDATION",
      message: "File exceeds max size.",
      requestId
    });
  }

  const id = generateDocId();
  const startedAt = new Date();
  const stageTimer = createStageTimer("UPLOAD", startedAt.getTime());

  await ensureDataDirs();
  await fs.mkdir(getDocExportDir(id), { recursive: true });

  const uploadPath = getUploadPath(id, extension);
  const metaPath = getMetaPath(id);
  const progressPath = getProgressPath(id);
  const timeoutSec = config.limits.processTimeoutSec;

  let meta = buildPendingMeta({
    id,
    file,
    mimeType,
    uploadPath,
    sha256: "",
    configVersion: config.version,
    strict: config.strict,
    timeoutSec,
    startedAt,
    requestId
  });

  await writeJsonAtomic(metaPath, meta);
  await upsertIndexDoc(toDocMeta(meta));

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch (error) {
    meta = applyFailure(meta, {
      stage: "UPLOAD",
      message: "Failed to read the uploaded file.",
      finishedAt: new Date(),
      exitCode: -1,
      stderrTail: String(error)
    });
    await writeJsonAtomic(metaPath, meta);
    await upsertIndexDoc(toDocMeta(meta));
    return jsonError({
      status: 500,
      stage: "UPLOAD",
      message: "Failed to read the uploaded file.",
      requestId,
      docId: id
    });
  }

  try {
    await fs.writeFile(uploadPath, buffer);
  } catch (error) {
    meta = applyFailure(meta, {
      stage: "UPLOAD",
      message: "Failed to store the uploaded file.",
      finishedAt: new Date(),
      exitCode: -1,
      stderrTail: String(error)
    });
    await writeJsonAtomic(metaPath, meta);
    await upsertIndexDoc(toDocMeta(meta));
    return jsonError({
      status: 500,
      stage: "UPLOAD",
      message: "Failed to store the uploaded file.",
      requestId,
      docId: id
    });
  }

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  meta = applySource(meta, {
    file,
    mimeType,
    uploadPath,
    sha256
  });
  meta.processing = {
    ...meta.processing,
    stage: "SPAWN",
    progress: 5,
    message: "Starting worker.",
    requestId
  };
  stageTimer.transition("SPAWN");

  await writeJsonAtomic(metaPath, meta);
  await upsertIndexDoc(toDocMeta(meta));

  const pythonBin = process.env.PYTHON_BIN ?? "";
  const workerPath = process.env.DOCLING_WORKER ?? "";
  const progressState: ProgressState = {
    stage: "SPAWN",
    progress: 5,
    message: "Starting worker."
  };
  // WHY: Serialize progress/meta writes to avoid overlapping file operations.
  let writeQueue = Promise.resolve();
  let allowProgressWrites = true;

  const scheduleProgressWrite = async () => {
    writeQueue = writeQueue
      .then(async () => {
        if (!allowProgressWrites) {
          return;
        }
        await writeJsonAtomic(progressPath, {
          stage: progressState.stage,
          message: progressState.message,
          progress: progressState.progress,
          requestId,
          updatedAt: new Date().toISOString()
        });
      })
      .catch(() => undefined);
    return writeQueue;
  };

  const scheduleFinalWrite = async (nextMeta: MetaFile) => {
    writeQueue = writeQueue
      .then(() => writeJsonAtomic(metaPath, nextMeta))
      .catch(() => undefined);
    return writeQueue;
  };

  const handleProgressUpdate = (update: WorkerProgressUpdate) => {
    if (update.jobId && update.jobId !== id) {
      return;
    }
    meta = applyProgress(meta, update, progressState);
    if (update.stage) {
      stageTimer.transition(update.stage);
    }
    const stageValue = (update.stage ?? "").toUpperCase();
    if (stageValue === "DONE" || stageValue === "FAILED") {
      allowProgressWrites = false;
      return;
    }
    void scheduleProgressWrite();
  };

  void submitWorkerJob({
    pythonBin,
    workerPath,
    inputPath: uploadPath,
    docId: id,
    dataDir: getDataDir(),
    gatesPath: getGatesConfigPath(),
    doclingConfigPath: getDoclingConfigPath(),
    deviceOverride,
    requestId,
    timeoutMs: timeoutSec * 1000,
    stdoutTailBytes: config.limits.stdoutTailKb * 1024,
    stderrTailBytes: config.limits.stderrTailKb * 1024,
    onProgress: handleProgressUpdate
  })
    .then(async (result) => {
      allowProgressWrites = false;
      const timings = stageTimer.finish();
      meta = await finalizeMeta({
        meta,
        metaPath,
        file,
        mimeType,
        uploadPath,
        sha256,
        requestId,
        result,
        startedAt,
        timeoutSec,
        progressState
      });
      const timingLog = formatStageTimingsLog({
        docId: id,
        requestId,
        status: meta.processing.status,
        timings
      });
      if (timingLog) {
        console.info(timingLog);
        meta = appendLogLineToMeta(
          meta,
          timingLog,
          config.limits.stderrTailKb * 1024
        );
      }
      const workerTimingLog = formatWorkerTimingsLog({
        docId: id,
        requestId,
        timings: meta.processing.timings,
        accelerator: meta.processing.docling?.accelerator
      });
      if (workerTimingLog) {
        console.info(workerTimingLog);
        meta = appendLogLineToMeta(
          meta,
          workerTimingLog,
          config.limits.stderrTailKb * 1024
        );
      }
      await scheduleFinalWrite(meta);
      await fs.rm(progressPath, { force: true });
      await upsertIndexDoc(toDocMeta(meta));
    })
    .catch(async (error) => {
      allowProgressWrites = false;
      const workerError = error instanceof WorkerJobError ? error : null;
      const failureStage = workerError?.code === "WORKER_CRASHED" ? "PROCESS" : "SPAWN";
      const failureMessage = (() => {
        if (workerError?.code === "WORKER_CRASHED") {
          return "Worker crashed during processing.";
        }
        if (workerError?.code === "WORKER_PROTOCOL") {
          return "Worker communication failed.";
        }
        return "Failed to start the processing worker.";
      })();
      meta = applyFailure(meta, {
        stage: failureStage,
        message: failureMessage,
        finishedAt: new Date(),
        exitCode: -1,
        stderrTail: String(error)
      });
      const timingLog = formatStageTimingsLog({
        docId: id,
        requestId,
        status: meta.processing.status,
        timings: stageTimer.finish()
      });
      if (timingLog) {
        console.info(timingLog);
        meta = appendLogLineToMeta(
          meta,
          timingLog,
          config.limits.stderrTailKb * 1024
        );
      }
      await scheduleFinalWrite(meta);
      await fs.rm(progressPath, { force: true });
      await upsertIndexDoc(toDocMeta(meta));
    });

  return NextResponse.json<UploadResponse>(
    {
      id,
      originalFileName: file.name,
      status: "PENDING",
      requestId,
      stage: meta.processing.stage ?? "SPAWN",
      progress: meta.processing.progress ?? 0
    },
    { status: 202 }
  );
}

type ErrorResponseOptions = {
  status: number;
  stage: string;
  message: string;
  requestId: string;
  code?: string;
  missingEnv?: string[];
  docId?: string;
};

type UploadResponse = {
  id: string;
  originalFileName: string;
  status: DocStatus;
  requestId: string;
  stage: string;
  progress: number;
};

function jsonError(options: ErrorResponseOptions) {
  const { status, stage, message, requestId, code, missingEnv, docId } = options;
  return NextResponse.json(
    {
      error: {
        message,
        stage,
        requestId,
        code
      },
      requestId,
      docId,
      missingEnv
    },
    { status }
  );
}

type PendingMetaOptions = {
  id: string;
  file: File;
  mimeType: string;
  uploadPath: string;
  sha256: string;
  configVersion: number;
  strict: boolean;
  timeoutSec: number;
  startedAt: Date;
  requestId: string;
};

type FailureOptions = {
  stage: string;
  message: string;
  finishedAt: Date;
  exitCode: number;
  stdoutTail?: string;
  stderrTail?: string;
};

type ProgressUpdate = {
  stage?: string;
  message?: string;
  progress?: number;
  jobId?: string;
};

type ProgressState = {
  stage: string;
  message: string;
  progress: number;
};

type StageTiming = {
  stage: string;
  durationMs: number;
};

type StageTimer = {
  transition: (stage: string, atMs?: number) => void;
  finish: (atMs?: number) => StageTiming[];
};

type FinalizeOptions = {
  meta: MetaFile;
  metaPath: string;
  file: File;
  mimeType: string;
  uploadPath: string;
  sha256: string;
  requestId: string;
  result: WorkerJobResult;
  startedAt: Date;
  timeoutSec: number;
  progressState: ProgressState;
};

function buildPendingMeta(options: PendingMetaOptions): MetaFile {
  const startedAt = options.startedAt.toISOString();
  return {
    schemaVersion: 1,
    id: options.id,
    requestId: options.requestId,
    createdAt: startedAt,
    source: {
      originalFileName: options.file.name,
      mimeType: options.mimeType,
      sizeBytes: options.file.size,
      sha256: options.sha256,
      storedPath: options.uploadPath
    },
    processing: {
      status: "PENDING",
      stage: "UPLOAD",
      progress: 0,
      message: "Receiving upload.",
      requestId: options.requestId,
      startedAt,
      finishedAt: null,
      durationMs: 0,
      timeoutSec: options.timeoutSec,
      exitCode: 0,
      worker: {
        pythonBin: process.env.PYTHON_BIN ?? "UNKNOWN",
        pythonVersion: "UNKNOWN",
        doclingVersion: "UNKNOWN"
      }
    },
    outputs: {
      markdownPath: null,
      jsonPath: null,
      bytes: { markdown: 0, json: 0 }
    },
    metrics: {
      pages: 0,
      textChars: 0,
      mdChars: 0,
      textItems: 0,
      tables: 0,
      textCharsPerPageAvg: 0
    },
    qualityGates: {
      configVersion: options.configVersion,
      strict: options.strict,
      passed: false,
      failedGates: [],
      evaluated: []
    },
    logs: {
      stdoutTail: "",
      stderrTail: ""
    }
  };
}

function applySource(
  meta: MetaFile,
  options: {
    file: File;
    mimeType: string;
    uploadPath: string;
    sha256: string;
  }
): MetaFile {
  return {
    ...meta,
    source: {
      ...meta.source,
      originalFileName: options.file.name,
      mimeType: options.mimeType,
      sizeBytes: options.file.size,
      sha256: options.sha256,
      storedPath: options.uploadPath
    }
  };
}

function applyFailure(meta: MetaFile, options: FailureOptions): MetaFile {
  const startedAt = resolveStartedAt(meta, options.finishedAt);
  const processing = {
    ...meta.processing,
    status: "FAILED" as const,
    stage: options.stage,
    message: options.message,
    exitCode: options.exitCode,
    finishedAt: options.finishedAt.toISOString(),
    durationMs: options.finishedAt.getTime() - startedAt.getTime()
  };

  return {
    ...meta,
    processing,
    outputs: {
      markdownPath: null,
      jsonPath: null,
      bytes: { markdown: 0, json: 0 }
    },
    qualityGates: {
      ...meta.qualityGates,
      passed: false
    },
    logs: {
      stdoutTail: options.stdoutTail ?? "",
      stderrTail: options.stderrTail ?? ""
    }
  };
}

function applyProgress(
  meta: MetaFile,
  update: ProgressUpdate,
  progressState: ProgressState
): MetaFile {
  const processing = { ...meta.processing };
  if (update.stage) {
    processing.stage = update.stage;
    progressState.stage = update.stage;
  }
  if (typeof update.progress === "number") {
    const clamped = clampProgress(update.progress);
    processing.progress = clamped;
    progressState.progress = clamped;
  }
  if (update.message) {
    processing.message = update.message;
    progressState.message = update.message;
  }
  return {
    ...meta,
    processing
  };
}

function clampProgress(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isFileLike(value: FormDataEntryValue | null): value is File {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as File;
  return (
    typeof candidate.arrayBuffer === "function" &&
    typeof candidate.name === "string" &&
    typeof candidate.type === "string"
  );
}

function resolveExtension(extension: string, mimeType: string) {
  if (extension) {
    return extension;
  }
  if (mimeType === "application/pdf") {
    return ".pdf";
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return ".docx";
  }
  return "";
}

function parseDeviceOverride(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "auto" || normalized === "cpu" || normalized === "cuda") {
    return normalized;
  }
  return null;
}

function resolveStartedAt(meta: MetaFile, fallback: Date) {
  const startedAt = meta.processing.startedAt;
  if (typeof startedAt === "string") {
    const parsed = new Date(startedAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return fallback;
}

function createStageTimer(initialStage: string, startedAtMs: number): StageTimer {
  let currentStage = initialStage;
  let currentStartedAt = startedAtMs;
  const timings: StageTiming[] = [];

  const recordStage = (atMs: number) => {
    if (!currentStage) {
      return;
    }
    const durationMs = Math.max(0, atMs - currentStartedAt);
    timings.push({ stage: currentStage, durationMs });
  };

  return {
    transition(stage, atMs = Date.now()) {
      if (!stage || stage === currentStage) {
        return;
      }
      recordStage(atMs);
      currentStage = stage;
      currentStartedAt = atMs;
    },
    finish(atMs = Date.now()) {
      recordStage(atMs);
      return timings;
    }
  };
}

function formatStageTimingsLog(options: {
  docId: string;
  requestId: string;
  status: DocStatus;
  timings: StageTiming[];
}) {
  const { docId, requestId, status, timings } = options;
  if (!timings.length) {
    return null;
  }
  const totalMs = timings.reduce((sum, item) => sum + item.durationMs, 0);
  return JSON.stringify({
    event: "stage_timings",
    docId,
    requestId,
    status,
    totalMs,
    timings
  });
}

function formatWorkerTimingsLog(options: {
  docId: string;
  requestId: string;
  timings: MetaFile["processing"]["timings"];
  accelerator?: string;
}) {
  const { docId, requestId, timings, accelerator } = options;
  if (!timings) {
    return null;
  }
  return JSON.stringify({
    event: "worker_stage_timings",
    docId,
    requestId,
    timings,
    accelerator
  });
}

function appendLogLineToMeta(meta: MetaFile, line: string, maxBytes: number): MetaFile {
  const logs = meta.logs ?? { stdoutTail: "", stderrTail: "" };
  return {
    ...meta,
    logs: {
      ...logs,
      stderrTail: appendLogLine(logs.stderrTail ?? "", line, maxBytes)
    }
  };
}

function appendLogLine(current: string, line: string, maxBytes: number) {
  if (maxBytes <= 0) {
    return "";
  }
  const separator = current && !current.endsWith("\n") ? "\n" : "";
  const next = `${current}${separator}${line}`;
  const encoded = Buffer.from(next, "utf-8");
  if (encoded.length <= maxBytes) {
    return next;
  }
  return encoded.subarray(encoded.length - maxBytes).toString("utf-8");
}

async function finalizeMeta(options: FinalizeOptions) {
  const {
    metaPath,
    file,
    mimeType,
    uploadPath,
    sha256,
    requestId,
    result,
    startedAt,
    timeoutSec,
    progressState
  } = options;
  const finishedAt = new Date();
  let meta = options.meta;

  // WHY: Grab a fresh meta snapshot in case progress writes updated the file.
  const snapshot = await readMetaSnapshot(metaPath, 3, 50);
  if (snapshot) {
    meta = snapshot;
  }

  meta = applySource(meta, { file, mimeType, uploadPath, sha256 });
  meta.requestId = requestId;

  const processing = { ...meta.processing };
  const started = resolveStartedAt(meta, startedAt);
  processing.startedAt = processing.startedAt ?? started.toISOString();
  processing.finishedAt = finishedAt.toISOString();
  processing.durationMs = finishedAt.getTime() - started.getTime();
  processing.timeoutSec = timeoutSec;
  processing.exitCode = result.exitCode;
  processing.requestId = requestId;

  if (result.timedOut) {
    processing.status = "FAILED";
    processing.stage = "TIMEOUT";
    processing.message = `Worker timed out after ${timeoutSec}s.`;
  } else if (result.exitCode !== 0) {
    processing.status = "FAILED";
    processing.stage = processing.stage ?? "PROCESS";
    processing.message = processing.message ?? `Worker exited with code ${result.exitCode}.`;
  } else if (processing.status === "PENDING") {
    processing.status = "SUCCESS";
  }

  const hasOutputs = Boolean(meta.outputs.markdownPath) && Boolean(meta.outputs.jsonPath);
  if (processing.status === "SUCCESS" && !hasOutputs) {
    processing.status = "FAILED";
    processing.stage = "FAILED";
    processing.message = "Worker did not produce outputs.";
  }

  if (processing.status === "SUCCESS") {
    processing.stage = processing.stage ?? "DONE";
    processing.message = processing.message ?? "Processing complete.";
    processing.progress = 100;
  } else if (processing.status === "FAILED") {
    processing.stage = processing.stage ?? "FAILED";
    if (!processing.message) {
      processing.message =
        result.exitCode === 0 && !result.timedOut
          ? "Quality gates failed."
          : "Processing failed.";
    }
    if (typeof processing.progress !== "number") {
      processing.progress = progressState.progress;
    }
  }

  if (!processing.stage) {
    processing.stage = progressState.stage;
  }
  if (!processing.message) {
    processing.message = progressState.message;
  }
  if (typeof processing.progress !== "number") {
    processing.progress = progressState.progress;
  }

  const nextMeta: MetaFile = {
    ...meta,
    processing,
    logs: {
      stdoutTail: result.stdoutTail,
      stderrTail: result.stderrTail
    }
  };

  if (processing.status !== "SUCCESS") {
    nextMeta.outputs = {
      markdownPath: null,
      jsonPath: null,
      bytes: { markdown: 0, json: 0 }
    };
    nextMeta.qualityGates = {
      ...nextMeta.qualityGates,
      passed: false
    };
  }

  return nextMeta;
}

async function readMetaSnapshot(
  metaPath: string,
  attempts: number,
  delayMs: number
): Promise<MetaFile | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const raw = await fs.readFile(metaPath, "utf-8");
      return parseMetaSnapshot(raw);
    } catch (error) {
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  return null;
}

function parseMetaSnapshot(raw: string): MetaFile {
  const parsed = JSON.parse(raw);
  return metaFileSchema.parse(parsed);
}
