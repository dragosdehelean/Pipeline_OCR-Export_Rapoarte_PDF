/**
 * @fileoverview Unit tests for utility helpers.
 */
import { getFileExtension, generateDocId } from "../../../app/_lib/utils";

describe("getFileExtension", () => {
  it("returns lowercase extension with dot for standard files", () => {
    expect(getFileExtension("document.pdf")).toBe(".pdf");
    expect(getFileExtension("report.PDF")).toBe(".pdf");
    expect(getFileExtension("file.DOCX")).toBe(".docx");
  });

  it("returns lowercase extension for files with multiple dots", () => {
    expect(getFileExtension("archive.tar.gz")).toBe(".gz");
    expect(getFileExtension("backup.2024.PDF")).toBe(".pdf");
  });

  it("returns empty string for files without extension", () => {
    expect(getFileExtension("README")).toBe("");
    expect(getFileExtension("Makefile")).toBe("");
  });

  it("returns empty string for files ending with dot", () => {
    expect(getFileExtension("file.")).toBe(".");
  });

  it("handles hidden files on Unix", () => {
    expect(getFileExtension(".gitignore")).toBe("");
    expect(getFileExtension(".env.local")).toBe(".local");
  });

  it("handles paths with directories", () => {
    expect(getFileExtension("path/to/document.pdf")).toBe(".pdf");
    expect(getFileExtension("C:\\Users\\Documents\\file.DOCX")).toBe(".docx");
  });

  it("handles empty string", () => {
    expect(getFileExtension("")).toBe("");
  });

  it("handles special characters in filename", () => {
    expect(getFileExtension("my document (1).pdf")).toBe(".pdf");
    expect(getFileExtension("report-2024.PDF")).toBe(".pdf");
  });
});

describe("generateDocId", () => {
  it("generates id with doc_ prefix", () => {
    const id = generateDocId();
    expect(id).toMatch(/^doc_[a-f0-9]{32}$/);
  });

  it("generates unique ids", () => {
    const id1 = generateDocId();
    const id2 = generateDocId();
    expect(id1).not.toBe(id2);
  });

  it("generates ids without hyphens", () => {
    const id = generateDocId();
    expect(id).not.toContain("-");
  });

  it("generates ids with correct length", () => {
    const id = generateDocId();
    expect(id).toHaveLength(36); // 'doc_' (4) + 32 hex chars
  });
});
