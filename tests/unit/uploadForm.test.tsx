import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import UploadForm from "../../components/UploadForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn()
  })
}));

describe("UploadForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("disables upload and shows setup required when health is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          missingEnv: ["PYTHON_BIN", "DOCLING_WORKER"],
          resolved: { PYTHON_BIN: null, DOCLING_WORKER: null },
          config: null,
          configError: null
        })
      } as unknown as Response)
    );

    render(<UploadForm />);

    expect(await screen.findByText("Setup required")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Upload" });
    expect(button).toBeDisabled();
  });

  it("shows requirements and enables upload after file selection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          missingEnv: [],
          resolved: { PYTHON_BIN: "python", DOCLING_WORKER: "worker.py" },
          config: {
            accept: { mimeTypes: ["application/pdf"], extensions: [".pdf", ".docx"] },
            limits: { maxFileSizeMb: 150, maxPages: 500, processTimeoutSec: 300 }
          },
          configError: null
        })
      } as unknown as Response)
    );

    render(<UploadForm />);

    const maxSizeLabel = await screen.findByText("Max file size:", { selector: "span" });
    expect(maxSizeLabel.parentElement).toHaveTextContent("150 MB");
    const allowedLabel = screen.getByText("Allowed:", { selector: "span" });
    expect(allowedLabel.parentElement).toHaveTextContent(".pdf, .docx");

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
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          missingEnv: [],
          resolved: { PYTHON_BIN: "python", DOCLING_WORKER: "worker.py" },
          config: {
            accept: { mimeTypes: ["application/pdf"], extensions: [".pdf", ".docx"] },
            limits: { maxFileSizeMb: 150, maxPages: 500, processTimeoutSec: 300 }
          },
          configError: null
        })
      } as unknown as Response)
    );

    render(<UploadForm />);

    const input = await screen.findByLabelText("Choose a file");
    const file = new File(["content"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(
      await screen.findByText("Unsupported file type. Allowed: .pdf, .docx.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
  });

  it("shows a post-upload banner with a details link", async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          missingEnv: [],
          resolved: { PYTHON_BIN: "python", DOCLING_WORKER: "worker.py" },
          config: {
            accept: { mimeTypes: ["application/pdf"], extensions: [".pdf", ".docx"] },
            limits: { maxFileSizeMb: 150, maxPages: 500, processTimeoutSec: 300 }
          },
          configError: null
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "doc-123",
          originalFileName: "sample.pdf",
          status: "SUCCESS"
        })
      } as unknown as Response);

    vi.stubGlobal("fetch", fetchMock);

    render(<UploadForm />);

    const input = await screen.findByLabelText("Choose a file");
    const file = new File(["content"], "sample.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("Upload complete")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View details" })).toHaveAttribute(
      "href",
      "/docs/doc-123"
    );
  });
});
