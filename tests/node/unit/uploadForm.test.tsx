import { fireEvent, screen } from "@testing-library/react";
import { vi } from "vitest";
import UploadForm from "../../../app/_components/UploadForm";
import gatesConfig from "../../../config/quality-gates.json";
import metaSuccessFixture from "../../fixtures/meta/meta.success.json";
import { metaFileSchema } from "../../../app/_lib/schema";
import { renderWithClient } from "../utils/render";

const healthConfig = {
  accept: gatesConfig.accept,
  limits: {
    maxFileSizeMb: gatesConfig.limits.maxFileSizeMb,
    maxPages: gatesConfig.limits.maxPages,
    processTimeoutSec: gatesConfig.limits.processTimeoutSec
  }
};
const acceptLabel = healthConfig.accept.extensions.join(", ");
const maxFileSizeMb = healthConfig.limits.maxFileSizeMb;

const jsonResponse = (payload: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init
  });

type MockPayload = Record<string, unknown>;

class MockXHR {
  static status = 200;
  static responsePayload: MockPayload = {};
  static triggerError = false;
  responseType: XMLHttpRequestResponseType = "";
  response: MockPayload | null = null;
  responseText = "";
  status = 0;
  upload = {
    onprogress: null as null | ((event: ProgressEvent) => void)
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  open() {
    return;
  }

  send() {
    if (MockXHR.triggerError) {
      if (this.onerror) {
        this.onerror();
      }
      return;
    }
    this.status = MockXHR.status;
    this.response = MockXHR.responsePayload;
    if (!this.responseType && this.responsePayload) {
      this.responseText = JSON.stringify(this.responsePayload);
    }
    if (this.upload.onprogress) {
      this.upload.onprogress({
        lengthComputable: true,
        loaded: 1,
        total: 1
      } as ProgressEvent);
    }
    if (this.onload) {
      this.onload();
    }
  }
}

describe("UploadForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    MockXHR.triggerError = false;
    MockXHR.status = 200;
    MockXHR.responsePayload = {};
  });

  it("disables upload and shows setup required when health is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          ok: false,
          missingEnv: ["PYTHON_BIN", "DOCLING_WORKER"],
          resolved: { PYTHON_BIN: null, DOCLING_WORKER: null },
          config: null,
          configError: null
        })
      )
    );

    renderWithClient(<UploadForm />);

    expect(await screen.findByText("Setup required")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Upload" });
    expect(button).toBeDisabled();
  });

  it("shows requirements and enables upload after file selection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          ok: true,
          missingEnv: [],
          resolved: { PYTHON_BIN: "python", DOCLING_WORKER: "worker.py" },
          config: healthConfig,
          configError: null
        })
      )
    );

    renderWithClient(<UploadForm />);

    const maxSizeLabel = await screen.findByText("Max file size:", { selector: "span" });
    expect(maxSizeLabel.parentElement).toHaveTextContent(`${maxFileSizeMb} MB`);
    const allowedLabel = screen.getByText("Allowed:", { selector: "span" });
    expect(allowedLabel.parentElement).toHaveTextContent(acceptLabel);

    const input = screen.getByLabelText("Choose a file");
    const file = new File(["content"], "sample.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    const summary = await screen.findByTestId("selected-file");
    expect(summary).toHaveTextContent("sample.pdf");

    const uploadButton = screen.getByRole("button", { name: "Upload" });
    expect(uploadButton).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByTestId("selected-file")).not.toBeInTheDocument();
    expect(uploadButton).toBeDisabled();
  });

  it("blocks unsupported file types and shows warning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          ok: true,
          missingEnv: [],
          resolved: { PYTHON_BIN: "python", DOCLING_WORKER: "worker.py" },
          config: healthConfig,
          configError: null
        })
      )
    );

    renderWithClient(<UploadForm />);

    const input = await screen.findByLabelText("Choose a file");
    const file = new File(["content"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(
      await screen.findByText(`Unsupported file type. Allowed: ${acceptLabel}.`)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
  });

  it("shows a post-upload banner with a details link", async () => {
    const fetchMock = vi.fn();
    const metaSuccess = metaFileSchema.parse({
      ...metaSuccessFixture,
      id: "doc-123",
      source: {
        ...metaSuccessFixture.source,
        originalFileName: "sample.pdf"
      }
    });
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          missingEnv: [],
          resolved: { PYTHON_BIN: "python", DOCLING_WORKER: "worker.py" },
          config: healthConfig,
          configError: null
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(metaSuccess)
      );

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", MockXHR as unknown as typeof XMLHttpRequest);
    MockXHR.status = 202;
    MockXHR.responsePayload = {
      id: "doc-123",
      originalFileName: "sample.pdf",
      status: "PENDING",
      stage: "SPAWN",
      progress: 5
    };

    renderWithClient(<UploadForm />);

    const input = await screen.findByLabelText("Choose a file");
    const file = new File(["content"], "sample.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("Processing complete")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View details" })).toHaveAttribute(
      "href",
      "/docs/doc-123"
    );
  });
});
