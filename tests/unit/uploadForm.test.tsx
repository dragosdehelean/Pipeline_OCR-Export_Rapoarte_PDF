import React from "react";
import { render, screen } from "@testing-library/react";
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
          resolved: { PYTHON_BIN: null, DOCLING_WORKER: null }
        })
      } as unknown as Response)
    );

    render(<UploadForm />);

    expect(await screen.findByText("Setup required")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Upload" });
    expect(button).toBeDisabled();
  });
});
