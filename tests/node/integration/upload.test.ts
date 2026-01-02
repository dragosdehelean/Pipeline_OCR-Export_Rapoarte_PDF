/**
 * @fileoverview Integration tests for the upload and docs API flow.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { POST as upload } from "../../../app/api/docs/upload/route";
import { GET as listDocs } from "../../../app/api/docs/route";
import { GET as getMeta } from "../../../app/api/docs/[id]/route";
import { GET as getHealth } from "../../../app/api/health/route";
import { metaFileSchema, type MetaFile } from "../../../app/_lib/schema";
import { shutdownWorker } from "../../../app/_lib/workerClient";

async function createTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "doc-ingest-"));
}

async function waitForMeta(id: string, timeoutMs = 2000): Promise<MetaFile> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await getMeta(new Request("http://localhost/api/docs/" + id), {
      params: Promise.resolve({ id })
    });
    if (response.ok) {
      const payload = await response.json();
      const parsed = metaFileSchema.safeParse(payload);
      if (
        parsed.success &&
        parsed.data.processing?.status &&
        parsed.data.processing.status !== "PENDING"
      ) {
        return parsed.data;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for worker to finish.");
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
      "tests",
      "fixtures",
      "worker",
      "fake_worker.py"
    );
    process.env.PYTHON_BIN = process.env.PYTHON_BIN || "python";
  });

  afterAll(async () => {
    await shutdownWorker();
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
    const file = new File(["BT (Hello) Tj ET"], "good.pdf", {
      type: "application/pdf"
    });
    formData.append("file", file);

    const request = new Request("http://localhost/api/docs/upload", {
      method: "POST",
      body: formData
    });

    const response = await upload(request);
    const payload = await response.json();
    expect(response.status).toBe(202);
    expect(payload.status).toBe("PENDING");
    const meta = await waitForMeta(payload.id);
    expect(meta.processing.status).toBe("SUCCESS");
    expect(meta.docling?.requested?.profile).toBeDefined();
    expect(meta.docling?.effective?.pdfBackendEffective).toBeDefined();
    expect(meta.docling?.effective?.tableModeEffective).toBeDefined();
    expect(meta.docling?.effective?.doCellMatchingEffective).not.toBeUndefined();

    const listResponse = await listDocs();
    const listPayload = await listResponse.json();
    expect(listPayload.docs.length).toBeGreaterThan(0);

    const healthResponse = await getHealth();
    const healthPayload = await healthResponse.json();
    expect(healthPayload.docling?.profiles).toBeDefined();
    expect(healthPayload.doclingWorker?.capabilities?.doclingVersion).toBeDefined();
    expect(healthPayload.doclingWorker?.lastJob?.docId).toBe(payload.id);
  });

  it("uploads a bad document and returns failed status", async () => {
    const formData = new FormData();
    const file = new File(["bad"], "bad.pdf", { type: "application/pdf" });
    formData.append("file", file);

    const request = new Request("http://localhost/api/docs/upload", {
      method: "POST",
      body: formData
    });

    const response = await upload(request);
    const payload = await response.json();
    expect(payload.status).toBe("PENDING");
    const meta = await waitForMeta(payload.id);
    expect(meta.processing.status).toBe("FAILED");
    expect(meta.qualityGates.failedGates.length).toBeGreaterThan(0);
  });

});
