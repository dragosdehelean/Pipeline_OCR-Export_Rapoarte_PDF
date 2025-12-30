/**
 * @fileoverview Filesystem helpers for document storage paths and indexes.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { docsIndexSchema, metaFileSchema, type DocMeta, type DocsIndex, type MetaFile } from "./schema";

export type DocIndexEntry = DocMeta;

/**
 * Resolves the root data directory from env or defaults.
 */
export function getDataDir(): string {
  const envDir = process.env.DATA_DIR ?? "./data";
  return path.resolve(process.cwd(), envDir);
}

/**
 * Returns the uploads directory path.
 */
export function getUploadsDir(): string {
  return path.join(getDataDir(), "uploads");
}

/**
 * Returns the exports directory path.
 */
export function getExportsDir(): string {
  return path.join(getDataDir(), "exports");
}

/**
 * Returns the export directory for a specific document id.
 */
export function getDocExportDir(id: string): string {
  return path.join(getExportsDir(), id);
}

/**
 * Builds the path for a stored upload by id and extension.
 */
export function getUploadPath(id: string, extension: string): string {
  const safeExt = extension.startsWith(".") ? extension : `.${extension}`;
  return path.join(getUploadsDir(), `${id}${safeExt}`);
}

/**
 * Returns the meta.json path for a document.
 */
export function getMetaPath(id: string): string {
  return path.join(getDocExportDir(id), "meta.json");
}

/**
 * Returns the progress.json path for a document.
 */
export function getProgressPath(id: string): string {
  return path.join(getDocExportDir(id), "progress.json");
}

/**
 * Returns the markdown output path for a document.
 */
export function getMarkdownPath(id: string): string {
  return path.join(getDocExportDir(id), "output.md");
}

/**
 * Returns the JSON output path for a document.
 */
export function getJsonPath(id: string): string {
  return path.join(getDocExportDir(id), "output.json");
}

/**
 * Returns the index.json path.
 */
export function getIndexPath(): string {
  return path.join(getDataDir(), "index.json");
}

/**
 * Ensures the upload and export directories exist.
 */
export async function ensureDataDirs(): Promise<void> {
  await fs.mkdir(getUploadsDir(), { recursive: true });
  await fs.mkdir(getExportsDir(), { recursive: true });
}

/**
 * Reads the docs index from disk and validates its shape.
 */
export async function readIndex(): Promise<DocsIndex> {
  const indexPath = getIndexPath();
  try {
    const raw = await fs.readFile(indexPath, "utf-8");
    const parsed = docsIndexSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return { docs: [] };
    }
    return parsed.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { docs: [] };
    }
    throw error;
  }
}

/**
 * Writes the docs index to disk.
 */
export async function writeIndex(index: DocsIndex): Promise<void> {
  await writeJsonAtomic(getIndexPath(), index);
}

/**
 * Inserts or updates a document entry in the index.
 */
export async function upsertIndexDoc(doc: DocIndexEntry): Promise<void> {
  const index = await readIndex();
  const existingIndex = index.docs.findIndex((entry) => entry.id === doc.id);
  if (existingIndex >= 0) {
    index.docs[existingIndex] = doc;
  } else {
    index.docs.unshift(doc);
  }
  index.docs = index.docs.slice(0, 200);
  await writeIndex(index);
}

/**
 * Returns recent documents from the index.
 */
export async function listDocs(limit = 50): Promise<DocIndexEntry[]> {
  const index = await readIndex();
  return index.docs.slice(0, limit);
}

/**
 * Reads meta.json and overlays any progress.json fields when present.
 */
export async function readMetaFile(id: string): Promise<MetaFile> {
  const raw = await fs.readFile(getMetaPath(id), "utf-8");
  const meta = metaFileSchema.parse(JSON.parse(raw));
  try {
    // WHY: progress.json provides incremental updates before meta.json is rewritten.
    const progressRaw = await fs.readFile(getProgressPath(id), "utf-8");
    const progress = JSON.parse(progressRaw);
    if (isRecord(progress)) {
      if (typeof progress.stage === "string") {
        meta.processing.stage = progress.stage;
      }
      if (typeof progress.progress === "number") {
        meta.processing.progress = progress.progress;
      }
      if (typeof progress.message === "string") {
        meta.processing.message = progress.message;
      }
      if (typeof progress.requestId === "string") {
        meta.processing.requestId = progress.requestId;
        meta.requestId = progress.requestId;
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  return meta;
}

/**
 * Writes JSON atomically to avoid partial reads.
 */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const unique = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  const tmpPath = `${filePath}.${unique}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), "utf-8");
  await renameWithRetry(tmpPath, filePath, 4, 50);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function renameWithRetry(
  fromPath: string,
  toPath: string,
  attempts: number,
  delayMs: number
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.rename(fromPath, toPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt < attempts - 1 && (code === "EPERM" || code === "EACCES" || code === "EBUSY")) {
        // WHY: Windows can transiently lock files during rapid writes.
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    }
  }
}
