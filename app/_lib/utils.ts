import crypto from "node:crypto";
import path from "node:path";

export function generateDocId(): string {
  return `doc_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function getFileExtension(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}
