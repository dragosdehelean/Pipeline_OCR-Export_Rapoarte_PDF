import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getUploadPath,
  getDataDir,
  writeJsonAtomic,
  readIndex,
  upsertIndexDoc
} from "../../../app/_lib/storage";

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
    const doc = {
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
    await upsertIndexDoc(doc);
    const index = await readIndex();
    expect(index.docs[0].id).toBe("doc_123");
  });

});
