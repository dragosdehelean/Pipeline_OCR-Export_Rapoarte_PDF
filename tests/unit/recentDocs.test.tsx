import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import RecentDocs from "../../components/RecentDocs";
import type { DocMeta } from "../../lib/schema";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  )
}));

const baseDoc: DocMeta = {
  id: "doc-1",
  originalFileName: "sample.pdf",
  mimeType: "application/pdf",
  createdAt: new Date("2025-01-01T10:00:00Z").toISOString(),
  status: "SUCCESS",
  metrics: {
    pages: 1,
    textChars: 1200,
    mdChars: 1100,
    textItems: 10,
    tables: 0,
    textCharsPerPageAvg: 1200
  },
  failedGates: [],
  logs: {
    stdoutTail: "",
    stderrTail: ""
  }
};

describe("RecentDocs", () => {
  it("filters by status and search query", () => {
    const docs: DocMeta[] = [
      { ...baseDoc, id: "doc-1", originalFileName: "good.pdf", status: "SUCCESS" },
      {
        ...baseDoc,
        id: "doc-2",
        originalFileName: "bad.pdf",
        status: "FAILED",
        failedGates: [
          { code: "TEXT_CHARS_MIN", message: "Too short", actual: 0, expectedOp: ">=", expected: 200 }
        ]
      }
    ];

    render(<RecentDocs docs={docs} />);

    expect(screen.getByRole("link", { name: "good.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "bad.pdf" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Failed" }));
    expect(screen.queryByRole("link", { name: "good.pdf" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "bad.pdf" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    const searchInput = screen.getByRole("searchbox", { name: "Search documents" });
    fireEvent.change(searchInput, { target: { value: "good" } });

    expect(screen.getByRole("link", { name: "good.pdf" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "bad.pdf" })).not.toBeInTheDocument();
  });
});
