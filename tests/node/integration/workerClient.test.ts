/**
 * @fileoverview Integration test for worker singleton reuse telemetry.
 */
import path from "node:path";
import { getWorker, shutdownWorker } from "../../../app/_lib/workerClient";

const workerPath = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "worker",
  "fake_worker.py"
);

describe("workerClient singleton", () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    process.env.PYTHON_BIN = process.env.PYTHON_BIN || "python";
    process.env.DOCLING_WORKER = workerPath;
  });

  afterAll(async () => {
    await shutdownWorker();
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
  });

  it("reuses the worker without reporting startup twice", async () => {
    const pythonBin = process.env.PYTHON_BIN ?? "python";
    const first = await getWorker({
      pythonBin,
      workerPath,
      timeoutMs: 5000
    });
    expect(first.spawnedThisCall).toBe(true);
    expect(first.workerReused).toBe(false);
    expect(first.pythonStartupMs).not.toBeNull();
    if (typeof first.pythonStartupMs === "number") {
      expect(first.pythonStartupMs).toBeGreaterThan(0);
    }

    const second = await getWorker({
      pythonBin,
      workerPath,
      timeoutMs: 5000
    });
    expect(second.spawnedThisCall).toBe(false);
    expect(second.workerReused).toBe(true);
    expect([0, null]).toContain(second.pythonStartupMs);
  });
});
