import fs from "fs/promises";
import path from "path";
import { type DocMeta } from "./schema";

export type DocIndexEntry = DocMeta;

type DocsIndex = {
  docs: DocIndexEntry[];
};

export function getDataDir(): string {
  const envDir = process.env.DATA_DIR || "./data";
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
    const parsed = JSON.parse(raw) as DocsIndex;
    if (!parsed.docs) {
      return { docs: [] };
    }
    return parsed;
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

export async function readMetaFile(id: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(getMetaPath(id), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), "utf-8");
  await fs.rename(tmpPath, filePath);
}
