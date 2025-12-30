/**
 * @fileoverview Runs a child process with output tailing and timeout control.
 */
import { spawn } from "node:child_process";

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
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
};

/**
 * Spawns a process and collects exit status plus tailed output.
 */
export function runProcess(options: RunOptions): Promise<ProcessResult> {
  const {
    command,
    args,
    cwd,
    timeoutMs,
    stdoutTailBytes,
    stderrTailBytes,
    onStdoutLine,
    onStderrLine
  } = options;
  const stdoutTail = createTailBuffer(stdoutTailBytes);
  const stderrTail = createTailBuffer(stderrTailBytes);
  const stdoutLines = onStdoutLine ? createLineBuffer() : null;
  const stderrLines = onStderrLine ? createLineBuffer() : null;

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
      if (stdoutLines && onStdoutLine) {
        stdoutLines.append(chunk, onStdoutLine);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail.append(chunk);
      if (stderrLines && onStderrLine) {
        stderrLines.append(chunk, onStderrLine);
      }
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      stdoutLines?.flush(onStdoutLine ?? (() => {}));
      stderrLines?.flush(onStderrLine ?? (() => {}));
      stderrTail.append(Buffer.from(String(error)));
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      stdoutLines?.flush(onStdoutLine ?? (() => {}));
      stderrLines?.flush(onStderrLine ?? (() => {}));
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

type LineBuffer = {
  append: (chunk: Buffer, onLine: (line: string) => void) => void;
  flush: (onLine: (line: string) => void) => void;
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

function createLineBuffer(): LineBuffer {
  let buffer = "";

  const flushLine = (line: string, onLine: (line: string) => void) => {
    const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (trimmed.length > 0) {
      onLine(trimmed);
    }
  };

  return {
    append(chunk, onLine) {
      buffer += chunk.toString("utf-8");
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        flushLine(line, onLine);
        index = buffer.indexOf("\n");
      }
    },
    flush(onLine) {
      if (buffer.length > 0) {
        flushLine(buffer, onLine);
        buffer = "";
      }
    }
  };
}
