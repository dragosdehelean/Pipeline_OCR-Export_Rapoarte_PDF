import crypto from "crypto";
import fs from "fs/promises";
import { NextResponse } from "next/server";
import { loadQualityGatesConfig, getGatesConfigPath } from "../../../../lib/config";
import { getMissingEnv } from "../../../../lib/env";
import {
  ensureDataDirs,
  getDataDir,
  getDocExportDir,
  getMetaPath,
  getUploadPath,
  upsertIndexDoc,
  writeJsonAtomic
} from "../../../../lib/storage";
import { runProcess } from "../../../../lib/processRunner";
import { generateDocId, getFileExtension } from "../../../../lib/utils";
import { toDocMeta } from "../../../../lib/meta";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const missingEnv = getMissingEnv();
  if (missingEnv.length > 0) {
    return NextResponse.json(
      {
        error: "Setup required.",
        code: "MISSING_ENV",
        missingEnv
      },
      { status: 500 }
    );
  }

  const config = await loadQualityGatesConfig();
  const formData = await req.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing file upload." }, { status: 400 });
  }

  const extension = getFileExtension(file.name);
  const mimeType = file.type;

  if (!config.accept.mimeTypes.includes(mimeType)) {
    return NextResponse.json({ error: "Unsupported mime type." }, { status: 400 });
  }

  if (!config.accept.extensions.includes(extension)) {
    return NextResponse.json({ error: "Unsupported file extension." }, { status: 400 });
  }

  const maxBytes = config.limits.maxFileSizeMb * 1024 * 1024;
  if (file.size > maxBytes) {
    return NextResponse.json({ error: "File exceeds max size." }, { status: 413 });
  }

  const id = generateDocId();
  await ensureDataDirs();

  const uploadPath = getUploadPath(id, extension);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(uploadPath, buffer);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  await fs.mkdir(getDocExportDir(id), { recursive: true });

  const pythonBin = process.env.PYTHON_BIN;
  const workerPath = process.env.DOCLING_WORKER;

  const startedAt = new Date();
  let result;

  try {
    result = await runProcess({
      command: pythonBin,
      args: [
        workerPath,
        "--input",
        uploadPath,
        "--doc-id",
        id,
        "--data-dir",
        getDataDir(),
        "--gates",
        getGatesConfigPath()
      ],
      timeoutMs: config.limits.processTimeoutSec * 1000,
      stdoutTailBytes: config.limits.stdoutTailKb * 1024,
      stderrTailBytes: config.limits.stderrTailKb * 1024
    });
  } catch (error) {
    const errorMeta = buildProcessingFailureMeta({
      id,
      file,
      mimeType,
      uploadPath,
      sha256,
      configVersion: config.version,
      strict: config.strict,
      timeoutSec: config.limits.processTimeoutSec,
      startedAt,
      finishedAt: new Date(),
      exitCode: -1,
      stdoutTail: "",
      stderrTail: String(error)
    });
    await writeJsonAtomic(getMetaPath(id), errorMeta);
    const docMeta = toDocMeta(errorMeta as Record<string, unknown>);
    await upsertIndexDoc(docMeta);
    return NextResponse.json(docMeta, { status: 500 });
  }

  const finishedAt = new Date();
  const metaPath = getMetaPath(id);
  let meta: Record<string, unknown> | null = null;

  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    meta = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    meta = null;
  }

  if (!meta) {
    meta = buildProcessingFailureMeta({
      id,
      file,
      mimeType,
      uploadPath,
      sha256,
      configVersion: config.version,
      strict: config.strict,
      timeoutSec: config.limits.processTimeoutSec,
      startedAt,
      finishedAt,
      exitCode: result.exitCode,
      stdoutTail: result.stdoutTail,
      stderrTail: result.stderrTail
    });
  }

  const source = (meta.source as Record<string, unknown>) ?? {};
  source.originalFileName = file.name;
  source.mimeType = mimeType;
  source.sizeBytes = file.size;
  source.sha256 = sha256;
  source.storedPath = uploadPath;
  meta.source = source;

  const processing = (meta.processing as Record<string, unknown>) ?? {};
  processing.status = result.timedOut || result.exitCode !== 0 ? "FAILED" : processing.status;
  processing.exitCode = result.exitCode;
  processing.timeoutSec = config.limits.processTimeoutSec;
  processing.startedAt = processing.startedAt || startedAt.toISOString();
  processing.finishedAt = finishedAt.toISOString();
  processing.durationMs = finishedAt.getTime() - startedAt.getTime();
  meta.processing = processing;

  const logs = (meta.logs as Record<string, unknown>) ?? {};
  logs.stdoutTail = result.stdoutTail;
  logs.stderrTail = result.stderrTail;
  meta.logs = logs;

  if (result.timedOut || result.exitCode !== 0) {
    meta.outputs = {
      markdownPath: null,
      jsonPath: null,
      bytes: { markdown: 0, json: 0 }
    };
    meta.qualityGates = {
      ...(meta.qualityGates as Record<string, unknown>),
      passed: false
    };
  }

  await writeJsonAtomic(metaPath, meta);
  const docMeta = toDocMeta(meta as Record<string, unknown>);
  await upsertIndexDoc(docMeta);

  return NextResponse.json(docMeta, { status: result.exitCode === 0 ? 200 : 500 });
}

type FailureMetaOptions = {
  id: string;
  file: File;
  mimeType: string;
  uploadPath: string;
  sha256: string;
  configVersion: number;
  strict: boolean;
  timeoutSec: number;
  startedAt: Date;
  finishedAt: Date;
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
};

function buildProcessingFailureMeta(options: FailureMetaOptions) {
  const { file } = options;
  return {
    schemaVersion: 1,
    id: options.id,
    createdAt: options.startedAt.toISOString(),
    source: {
      originalFileName: file.name,
      mimeType: options.mimeType,
      sizeBytes: file.size,
      sha256: options.sha256,
      storedPath: options.uploadPath
    },
    processing: {
      status: "FAILED",
      startedAt: options.startedAt.toISOString(),
      finishedAt: options.finishedAt.toISOString(),
      durationMs: options.finishedAt.getTime() - options.startedAt.getTime(),
      timeoutSec: options.timeoutSec,
      exitCode: options.exitCode,
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
      stdoutTail: options.stdoutTail,
      stderrTail: options.stderrTail
    }
  };
}
