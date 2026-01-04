/**
 * @fileoverview Integration tests for the upload and docs API flow.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { POST as upload } from "../../../app/api/docs/upload/route";
import { GET as listDocs } from "../../../app/api/docs/route";
import { DELETE as deleteDoc, GET as getMeta } from "../../../app/api/docs/[id]/route";
import { GET as getHealth } from "../../../app/api/health/route";
import type { PyMuPDFConfig } from "../../../app/_lib/config";
import * as configModule from "../../../app/_lib/config";
import { metaFileSchema, type MetaFile } from "../../../app/_lib/schema";
import { shutdownWorker } from "../../../app/_lib/workerClient";

const goodPdfPath = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "docs",
  "one_page_report.pdf"
);
const badPdfPath = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "docs",
  "scan_like_no_text.pdf"
);
const docxMime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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

async function buildPdfFile(fixturePath: string, name: string) {
  const bytes = await fs.readFile(fixturePath);
  return new File([bytes], name, { type: "application/pdf" });
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uploads a good document and lists it", async () => {
    const formData = new FormData();
    const file = await buildPdfFile(goodPdfPath, "good.pdf");
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
    const file = await buildPdfFile(badPdfPath, "bad.pdf");
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

  it("uploads a document with pymupdf4llm engine", async () => {
    const formData = new FormData();
    const file = await buildPdfFile(goodPdfPath, "good.pdf");
    formData.append("file", file);
    formData.append("engine", "pymupdf4llm");

    const request = new Request("http://localhost/api/docs/upload", {
      method: "POST",
      body: formData
    });

    const response = await upload(request);
    const payload = await response.json();
    expect(response.status).toBe(202);
    const meta = await waitForMeta(payload.id);
    expect(meta.processing.status).toBe("SUCCESS");
    expect(meta.engine?.requested?.name).toBe("pymupdf4llm");
    expect(meta.engine?.effective?.name).toBe("pymupdf4llm");
    expect(meta.engine?.effective?.layoutActive).toBe(true);
  });

  it("deletes a document and removes stored files", async () => {
    const formData = new FormData();
    const file = await buildPdfFile(goodPdfPath, "delete.pdf");
    formData.append("file", file);

    const request = new Request("http://localhost/api/docs/upload", {
      method: "POST",
      body: formData
    });

    const response = await upload(request);
    const payload = await response.json();
    expect(response.status).toBe(202);
    const meta = await waitForMeta(payload.id);
    expect(meta.processing.status).toBe("SUCCESS");

    const deleteResponse = await deleteDoc(
      new Request(`http://localhost/api/docs/${payload.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: payload.id }) }
    );
    expect(deleteResponse.status).toBe(200);
    const deletePayload = await deleteResponse.json();
    expect(deletePayload).toMatchObject({
      id: payload.id,
      deleted: true,
      removedIndex: true,
      removedUpload: true,
      removedExport: true
    });

    const listResponse = await listDocs();
    const listPayload = await listResponse.json();
    expect(
      listPayload.docs.find((doc: { id: string }) => doc.id === payload.id)
    ).toBeUndefined();

  });

  it("fails pymupdf4llm when layout deps are unavailable", async () => {
    const original = process.env.FAKE_PYMUPDF_LAYOUT_AVAILABLE;
    process.env.FAKE_PYMUPDF_LAYOUT_AVAILABLE = "0";
    await shutdownWorker();
    try {
      const formData = new FormData();
      const file = await buildPdfFile(goodPdfPath, "good.pdf");
      formData.append("file", file);
      formData.append("engine", "pymupdf4llm");

      const request = new Request("http://localhost/api/docs/upload", {
        method: "POST",
        body: formData
      });

      const response = await upload(request);
      const payload = await response.json();
      expect(response.status).toBe(202);
      const meta = await waitForMeta(payload.id);
      expect(meta.processing.status).toBe("FAILED");
      expect(meta.processing.failure?.code).toBe("PYMUPDF_LAYOUT_UNAVAILABLE");
      expect(meta.processing.failure?.message).toBe(
        "PyMuPDF4LLM layout-only: layout unavailable"
      );
    } finally {
      if (original === undefined) {
        delete process.env.FAKE_PYMUPDF_LAYOUT_AVAILABLE;
      } else {
        process.env.FAKE_PYMUPDF_LAYOUT_AVAILABLE = original;
      }
    }
  });

  it("uses docling for docx when pymupdf config fails", async () => {
    const loadSpy = vi
      .spyOn(configModule, "loadPyMuPDFConfig")
      .mockImplementation(async () => {
        throw new Error("pymupdf config unavailable");
      });
    const formData = new FormData();
    const file = new File(["BT (Hello) Tj ET"], "sample.docx", { type: docxMime });
    formData.append("file", file);

    const request = new Request("http://localhost/api/docs/upload", {
      method: "POST",
      body: formData
    });

    const response = await upload(request);
    const payload = await response.json();
    expect(response.status).toBe(202);
    const meta = await waitForMeta(payload.id);
    expect(meta.processing.status).toBe("SUCCESS");
    expect(meta.engine?.effective?.name).toBe("docling");
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it("uses docling for pdf when engine=docling even if pymupdf config fails", async () => {
    const loadSpy = vi
      .spyOn(configModule, "loadPyMuPDFConfig")
      .mockImplementation(async () => {
        throw new Error("pymupdf config unavailable");
      });
    const formData = new FormData();
    const file = await buildPdfFile(goodPdfPath, "good.pdf");
    formData.append("file", file);
    formData.append("engine", "docling");

    const request = new Request("http://localhost/api/docs/upload", {
      method: "POST",
      body: formData
    });

    const response = await upload(request);
    const payload = await response.json();
    expect(response.status).toBe(202);
    const meta = await waitForMeta(payload.id);
    expect(meta.processing.status).toBe("SUCCESS");
    expect(meta.engine?.effective?.name).toBe("docling");
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it("defaults to pymupdf4llm for pdf when engine omitted and config allows it", async () => {
    const rawConfig = JSON.parse(
      await fs.readFile(path.join(process.cwd(), "config", "pymupdf.json"), "utf-8")
    ) as PyMuPDFConfig;
    rawConfig.defaultEngine = "pymupdf4llm";
    const loadSpy = vi
      .spyOn(configModule, "loadPyMuPDFConfig")
      .mockResolvedValue(rawConfig);

    const formData = new FormData();
    const file = await buildPdfFile(goodPdfPath, "good.pdf");
    formData.append("file", file);

    const request = new Request("http://localhost/api/docs/upload", {
      method: "POST",
      body: formData
    });

    const response = await upload(request);
    const payload = await response.json();
    expect(response.status).toBe(202);
    const meta = await waitForMeta(payload.id);
    expect(meta.engine?.effective?.name).toBe("pymupdf4llm");
    expect(loadSpy).toHaveBeenCalled();
  });

  it("falls back to docling for pdf when engine omitted and config fails", async () => {
    const loadSpy = vi
      .spyOn(configModule, "loadPyMuPDFConfig")
      .mockImplementation(async () => {
        throw new Error("pymupdf config unavailable");
      });
    const formData = new FormData();
    const file = await buildPdfFile(goodPdfPath, "good.pdf");
    formData.append("file", file);

    const request = new Request("http://localhost/api/docs/upload", {
      method: "POST",
      body: formData
    });

    const response = await upload(request);
    const payload = await response.json();
    expect(response.status).toBe(202);
    const meta = await waitForMeta(payload.id);
    expect(meta.engine?.effective?.name).toBe("docling");
    expect(loadSpy).toHaveBeenCalled();
  });

});
