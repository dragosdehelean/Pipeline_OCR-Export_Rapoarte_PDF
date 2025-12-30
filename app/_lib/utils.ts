/**
 * @fileoverview Small utility helpers for document ids and filenames.
 */
import crypto from "node:crypto";
import path from "node:path";

/**
 * Generates a unique document id with a stable prefix.
 */
export function generateDocId(): string {
  return `doc_${crypto.randomUUID().replace(/-/g, "")}`;
}

/**
 * Returns the lowercase extension for a file name.
 */
export function getFileExtension(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}
