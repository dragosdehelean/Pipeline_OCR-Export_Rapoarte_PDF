import path from "path";
import {
  getUploadPath,
  getDataDir,
  writeJsonAtomic,
  readIndex,
  upsertIndexDoc
} from "../../lib/storage";

const originalDataDir = process.env.DATA_DIR;

describe("storage helpers", () => {
  beforeAll(() => {
    process.env.DATA_DIR = "./data-test";
  });

  afterAll(() => {
    process.env.DATA_DIR = originalDataDir;
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

  afterAll(async () => {
    const fs = await import("fs/promises");
    await fs.rm(getDataDir(), { recursive: true, force: true });
  });
});
