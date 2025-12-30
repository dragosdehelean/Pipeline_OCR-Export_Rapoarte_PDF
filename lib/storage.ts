import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { docsIndexSchema, metaFileSchema, type DocMeta, type DocsIndex, type MetaFile } from "./schema";

export type DocIndexEntry = DocMeta;

export function getDataDir(): string {
  const envDir = process.env.DATA_DIR ?? "./data";
  return path.resolve(process.cwd(), envDir);
}

export function getUploadsDir(): string {
  return path.join(getDataDir(), "uploads");
}

export function getExportsDir(): string {
  return path.join(getDataDir(), "exports");
}

export function getDocExportDir(id: string): string {
  return path.join(getExportsDir(), id);
}

export function getUploadPath(id: string, extension: string): string {
  const safeExt = extension.startsWith(".") ? extension : `.${extension}`;
  return path.join(getUploadsDir(), `${id}${safeExt}`);
}

export function getMetaPath(id: string): string {
  return path.join(getDocExportDir(id), "meta.json");
}

export function getProgressPath(id: string): string {
  return path.join(getDocExportDir(id), "progress.json");
}

export function getMarkdownPath(id: string): string {
  return path.join(getDocExportDir(id), "output.md");
}

export function getJsonPath(id: string): string {
  return path.join(getDocExportDir(id), "output.json");
}

export function getIndexPath(): string {
  return path.join(getDataDir(), "index.json");
}

export async function ensureDataDirs(): Promise<void> {
  await fs.mkdir(getUploadsDir(), { recursive: true });
  await fs.mkdir(getExportsDir(), { recursive: true });
}

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

export async function writeIndex(index: DocsIndex): Promise<void> {
  await writeJsonAtomic(getIndexPath(), index);
}

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

export async function listDocs(limit = 50): Promise<DocIndexEntry[]> {
  const index = await readIndex();
  return index.docs.slice(0, limit);
}

export async function readMetaFile(id: string): Promise<MetaFile> {
  const raw = await fs.readFile(getMetaPath(id), "utf-8");
  const meta = metaFileSchema.parse(JSON.parse(raw));
  try {
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

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const unique = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  const tmpPath = `${filePath}.${unique}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), "utf-8");
  await fs.rename(tmpPath, filePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
