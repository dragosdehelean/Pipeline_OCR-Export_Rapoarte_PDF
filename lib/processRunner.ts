import { spawn } from "child_process";

export type ProcessResult = {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdoutTail: string;
  stderrTail: string;
  timedOut: boolean;
};

type RunOptions = {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  stdoutTailBytes: number;
  stderrTailBytes: number;
};

export function runProcess(options: RunOptions): Promise<ProcessResult> {
  const { command, args, cwd, timeoutMs, stdoutTailBytes, stderrTailBytes } = options;
  const stdoutTail = createTailBuffer(stdoutTailBytes);
  const stderrTail = createTailBuffer(stderrTailBytes);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutTail.append(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail.append(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      stderrTail.append(Buffer.from(String(error)));
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({
        exitCode: typeof code === "number" ? code : -1,
        signal: signal ?? null,
        stdoutTail: stdoutTail.toString(),
        stderrTail: stderrTail.toString(),
        timedOut
      });
    });
  });
}

type TailBuffer = {
  append: (chunk: Buffer) => void;
  toString: () => string;
};

function createTailBuffer(maxBytes: number): TailBuffer {
  let buffer = Buffer.alloc(0);

  return {
    append(chunk: Buffer) {
      if (maxBytes <= 0) {
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > maxBytes) {
        buffer = buffer.subarray(buffer.length - maxBytes);
      }
    },
    toString() {
      return buffer.toString("utf-8");
    }
  };
}
