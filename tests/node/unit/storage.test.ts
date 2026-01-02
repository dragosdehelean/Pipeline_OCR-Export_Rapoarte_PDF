/**
 * @fileoverview Unit tests for storage helpers and index writes.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  deleteDocArtifacts,
  getUploadPath,
  getDataDir,
  getDocExportDir,
  getMetaPath,
  writeJsonAtomic,
  readIndex,
  upsertIndexDoc
} from "../../../app/_lib/storage";
import type { DocMeta } from "../../../app/_lib/schema";

const originalDataDir = process.env.DATA_DIR;

describe("storage helpers", () => {
  let tempDir = "";

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-storage-"));
    process.env.DATA_DIR = tempDir;
  });

  afterAll(async () => {
    process.env.DATA_DIR = originalDataDir;
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("builds upload path under data dir", () => {
    const uploadPath = getUploadPath("doc_123", ".pdf");
    expect(uploadPath).toContain(path.join(getDataDir(), "uploads", "doc_123.pdf"));
  });

  it("writes and reads index entries", async () => {
    const doc: DocMeta = {
      id: "doc_123",
      originalFileName: "test.pdf",
      mimeType: "application/pdf",
      createdAt: new Date(0).toISOString(),
      status: "SUCCESS",
      metrics: {
        pages: 1,
        textChars: 10,
        mdChars: 10,
        textItems: 1,
        tables: 0,
        textCharsPerPageAvg: 10
      },
      failedGates: [],
      logs: { stdoutTail: "", stderrTail: "" }
    };

    await writeJsonAtomic(path.join(getDataDir(), "index.json"), { docs: [] });
    await fs.mkdir(getDocExportDir(doc.id), { recursive: true });
    await upsertIndexDoc(doc);
    const index = await readIndex();
    expect(index.docs[0].id).toBe("doc_123");
  });

  it("deletes document artifacts and index entry", async () => {
    const doc: DocMeta = {
      id: "doc_delete",
      originalFileName: "delete.pdf",
      mimeType: "application/pdf",
      createdAt: new Date(0).toISOString(),
      status: "SUCCESS",
      metrics: {
        pages: 1,
        textChars: 10,
        mdChars: 10,
        textItems: 1,
        tables: 0,
        textCharsPerPageAvg: 10
      },
      failedGates: [],
      logs: { stdoutTail: "", stderrTail: "" }
    };
    const uploadPath = getUploadPath(doc.id, ".pdf");
    const exportDir = getDocExportDir(doc.id);
    const metaPath = getMetaPath(doc.id);

    const fixturePath = path.join(
      process.cwd(),
      "tests",
      "fixtures",
      "meta",
      "meta.success.json"
    );
    const meta = JSON.parse(await fs.readFile(fixturePath, "utf-8")) as Record<
      string,
      unknown
    >;
    (meta as { id: string }).id = doc.id;
    (meta as { source: { storedPath: string } }).source.storedPath = uploadPath;

    await writeJsonAtomic(path.join(getDataDir(), "index.json"), { docs: [doc] });
    await fs.mkdir(path.dirname(uploadPath), { recursive: true });
    await fs.mkdir(exportDir, { recursive: true });
    await writeJsonAtomic(metaPath, meta);
    await fs.writeFile(uploadPath, "fixture");

    const result = await deleteDocArtifacts(doc.id);
    expect(result.deleted).toBe(true);
    expect(result.removedIndex).toBe(true);
    expect(result.removedUpload).toBe(true);
    expect(result.removedExport).toBe(true);

    const index = await readIndex();
    expect(index.docs.find((entry) => entry.id === doc.id)).toBeUndefined();
    await expect(fs.access(uploadPath)).rejects.toThrow();
    await expect(fs.access(exportDir)).rejects.toThrow();
  });

});
