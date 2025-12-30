import fs from "node:fs";
import path from "node:path";
import { toDocMeta } from "../../lib/meta";
import { metaFileSchema } from "../../lib/schema";

describe("DocMeta schema mapping", () => {
  it("maps success meta fixture", () => {
    const fixturePath = path.join(
      process.cwd(),
      "fixtures",
      "meta",
      "meta.success.json"
    );
    const raw = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
    const docMeta = toDocMeta(metaFileSchema.parse(raw));
    expect(docMeta.status).toBe("SUCCESS");
    expect(docMeta.metrics.pages).toBeGreaterThan(0);
  });

  it("maps failed meta fixture", () => {
    const fixturePath = path.join(
      process.cwd(),
      "fixtures",
      "meta",
      "meta.failed.json"
    );
    const raw = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
    const docMeta = toDocMeta(metaFileSchema.parse(raw));
    expect(docMeta.status).toBe("FAILED");
    expect(docMeta.failedGates.length).toBeGreaterThan(0);
  });
});
