/**
 * @fileoverview Unit tests for PyMuPDF config schema validation.
 */
import fs from "node:fs";
import path from "node:path";
import { pymupdfConfigSchema } from "../../../app/_lib/config";

describe("pymupdf config schema", () => {
  it("parses the default pymupdf config", () => {
    const configPath = path.join(process.cwd(), "config", "pymupdf.json");
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const parsed = pymupdfConfigSchema.parse(raw);
    expect(parsed.defaultEngine).toBeDefined();
    expect(parsed.pymupdf4llm).toBeDefined();
  });

  it("rejects unknown toMarkdown keys", () => {
    const configPath = path.join(process.cwd(), "config", "pymupdf.json");
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const next = JSON.parse(JSON.stringify(raw));
    next.pymupdf4llm.toMarkdown.unsupported_key = true;
    expect(() => pymupdfConfigSchema.parse(next)).toThrow();
  });
});
