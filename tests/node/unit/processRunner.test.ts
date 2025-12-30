/**
 * @fileoverview Unit tests for the process runner tailing behavior.
 */
import { runProcess } from "../../../app/_lib/processRunner";

it("captures stdout and stderr tails", async () => {
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('hello'); process.stderr.write('error');"],
    timeoutMs: 2000,
    stdoutTailBytes: 4,
    stderrTailBytes: 3
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdoutTail).toBe("ello");
  expect(result.stderrTail).toBe("ror");
});
