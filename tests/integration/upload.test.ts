import fs from "fs/promises";
import os from "os";
import path from "path";
import { POST as upload } from "../../app/api/docs/upload/route";
import { GET as listDocs } from "../../app/api/docs/route";

async function createTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "doc-ingest-"));
}

describe("docs api integration", () => {
  let tempDir = "";
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    tempDir = await createTempDir();
    process.env.DATA_DIR = tempDir;
    process.env.GATES_CONFIG_PATH = path.join(
      process.cwd(),
      "config",
      "quality-gates.json"
    );
    process.env.DOCLING_WORKER = path.join(
      process.cwd(),
      "fixtures",
      "worker",
      "fake_worker.py"
    );
    process.env.PYTHON_BIN = process.env.PYTHON_BIN || "python";
  });

  afterAll(async () => {
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uploads a good document and lists it", async () => {
    const formData = new FormData();
    const blob = new Blob(["BT (Hello) Tj ET"], { type: "application/pdf" });
    formData.append("file", blob, "good.pdf");

    const request = new Request("http://localhost/api/docs/upload", {
      method: "POST",
      body: formData
    });

    const response = await upload(request);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe("SUCCESS");

    const listResponse = await listDocs();
    const listPayload = await listResponse.json();
    expect(listPayload.docs.length).toBeGreaterThan(0);
  });

  it("uploads a bad document and returns failed status", async () => {
    const formData = new FormData();
    const blob = new Blob(["bad"], { type: "application/pdf" });
    formData.append("file", blob, "bad.pdf");

    const request = new Request("http://localhost/api/docs/upload", {
      method: "POST",
      body: formData
    });

    const response = await upload(request);
    const payload = await response.json();
    expect(payload.status).toBe("FAILED");
    expect(payload.failedGates.length).toBeGreaterThan(0);
  });
});
