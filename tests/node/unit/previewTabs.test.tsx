/**
 * @fileoverview Unit tests for the PreviewTabs component.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import PreviewTabs from "../../../app/_components/PreviewTabs";

function mockClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true
  });
  return writeText;
}

describe("PreviewTabs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats json for display and copy", async () => {
    const writeText = mockClipboard();
    const json = "{\"a\":1,\"b\":{\"c\":2}}";
    const pretty = `{\n  \"a\": 1,\n  \"b\": {\n    \"c\": 2\n  }\n}\n`;

    render(<PreviewTabs json={json} />);

    const pre = document.querySelector("pre");
    expect(pre?.textContent).toBe(pretty);

    const copyButton = screen.getByRole("button", { name: "Copy" });
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(pretty);
    });
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("copies markdown when markdown tab is active", async () => {
    const writeText = mockClipboard();
    const markdown = "# Title\n- item";
    const json = "{\"ok\":true}";

    render(<PreviewTabs markdown={markdown} json={json} />);

    const copyButton = screen.getByRole("button", { name: "Copy" });
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(markdown);
    });
  });
});
