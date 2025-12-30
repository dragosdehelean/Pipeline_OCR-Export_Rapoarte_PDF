import fs from "node:fs";
import path from "node:path";
import { GET } from "../../../app/api/health/route";
import { qualityGatesSchema } from "../../../app/_lib/config";
import { getRequiredEnvKeys } from "../../../app/_lib/env";

describe("health api", () => {
  const originalEnv = { ...process.env };

  const resetEnv = () => {
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
  };

  afterEach(() => {
    resetEnv();
  });

  it("reports missing env vars", async () => {
    const requiredKeys = getRequiredEnvKeys();
    requiredKeys.forEach((key) => {
      delete process.env[key];
    });

    const response = await GET();
    const payload = await response.json();

    expect(payload.ok).toBe(false);
    requiredKeys.forEach((key) => {
      expect(payload.missingEnv).toContain(key);
    });
    expect(payload.resolved.PYTHON_BIN).toBeNull();
    expect(payload.resolved.DOCLING_WORKER).toBeNull();
    expect(payload.config).toBeNull();
  });

  it("reports ok when env is set", async () => {
    process.env.PYTHON_BIN = "python";
    process.env.DOCLING_WORKER = "worker.py";
    process.env.DATA_DIR = "./data";
    process.env.GATES_CONFIG_PATH = "./config/quality-gates.json";

    const response = await GET();
    const payload = await response.json();
    const gatesConfig = qualityGatesSchema.parse(
      JSON.parse(
        fs.readFileSync(
          path.join(process.cwd(), "config", "quality-gates.json"),
          "utf-8"
        )
      )
    );

    expect(payload.ok).toBe(true);
    expect(payload.missingEnv).toEqual([]);
    expect(payload.resolved.PYTHON_BIN).toBe("python");
    expect(payload.resolved.DOCLING_WORKER).toBe("worker.py");
    expect(payload.config.accept.extensions).toEqual(gatesConfig.accept.extensions);
    expect(payload.config.limits.maxFileSizeMb).toBe(gatesConfig.limits.maxFileSizeMb);
  });
});
