/**
 * @fileoverview Manages a keep-warm Docling worker process using JSONL IPC.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

export type WorkerStatusSnapshot = {
  status: "stopped" | "starting" | "ready" | "error";
  pid: number | null;
  lastError: string | null;
  pythonStartupMs: number | null;
};

export type WorkerProgressUpdate = {
  jobId?: string;
  stage?: string;
  message?: string;
  progress?: number;
};

export type WorkerJobResult = {
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
  timedOut: boolean;
};

/**
 * Represents worker lifecycle failures with stable error codes.
 */
export class WorkerJobError extends Error {
  code: "WORKER_START_FAILED" | "WORKER_CRASHED" | "WORKER_PROTOCOL";

  /**
   * Creates a worker job error with a stable code for downstream handling.
   */
  constructor(
    code: "WORKER_START_FAILED" | "WORKER_CRASHED" | "WORKER_PROTOCOL",
    message: string
  ) {
    super(message);
    this.code = code;
  }
}

type WorkerJobOptions = {
  pythonBin: string;
  workerPath: string;
  inputPath: string;
  docId: string;
  dataDir: string;
  gatesPath: string;
  doclingConfigPath: string;
  deviceOverride?: string | null;
  requestId: string;
  timeoutMs: number;
  stdoutTailBytes: number;
  stderrTailBytes: number;
  onProgress?: (update: WorkerProgressUpdate) => void;
};

type WorkerJob = WorkerJobOptions & {
  resolve: (result: WorkerJobResult) => void;
  reject: (error: WorkerJobError) => void;
  stdoutTail: TailBuffer;
  stderrTail: TailBuffer;
  timedOut: boolean;
  timeoutHandle: NodeJS.Timeout | null;
};

type TailBuffer = {
  append: (chunk: Buffer | string) => void;
  toString: () => string;
};

let workerProcess: ChildProcessWithoutNullStreams | null = null;
let workerStatus: WorkerStatusSnapshot = {
  status: "stopped",
  pid: null,
  lastError: null,
  pythonStartupMs: null
};
let workerKey = "";
let lastStartOptions: { pythonBin: string; workerPath: string } | null = null;
let lineReader: readline.Interface | null = null;
let activeJob: WorkerJob | null = null;
const jobQueue: WorkerJob[] = [];

/**
 * Returns a snapshot of the current worker status for health reporting.
 */
export function getWorkerStatus(): WorkerStatusSnapshot {
  return { ...workerStatus };
}

/**
 * Enqueues a Docling job and resolves once the worker finishes processing.
 */
export async function submitWorkerJob(options: WorkerJobOptions): Promise<WorkerJobResult> {
  ensureWorker(options.pythonBin, options.workerPath);
  return enqueueJob(options);
}

/**
 * Shuts down the keep-warm worker process, if running.
 */
export async function shutdownWorker(): Promise<void> {
  const process = workerProcess;
  if (!process) {
    return;
  }

  await new Promise<void>((resolve) => {
    const cleanup = () => resolve();
    process.once("exit", cleanup);
    process.once("error", cleanup);
    try {
      process.stdin.write(JSON.stringify({ type: "shutdown" }) + "\n");
    } catch (error) {
      process.kill("SIGKILL");
    }
    setTimeout(() => {
      if (!process.killed) {
        process.kill("SIGKILL");
      }
    }, 1000).unref();
  });
}

const enqueueJob = (options: WorkerJobOptions): Promise<WorkerJobResult> =>
  new Promise((resolve, reject) => {
    const job: WorkerJob = {
      ...options,
      resolve,
      reject,
      stdoutTail: createTailBuffer(options.stdoutTailBytes),
      stderrTail: createTailBuffer(options.stderrTailBytes),
      timedOut: false,
      timeoutHandle: null
    };
    jobQueue.push(job);
    flushQueue();
  });

const ensureWorker = (pythonBin: string, workerPath: string) => {
  const nextKey = `${pythonBin}::${workerPath}`;
  if (workerProcess && workerKey !== nextKey) {
    void shutdownWorker();
  }
  if (workerProcess) {
    return;
  }

  workerKey = nextKey;
  lastStartOptions = { pythonBin, workerPath };
  workerStatus = {
    status: "starting",
    pid: null,
    lastError: null,
    pythonStartupMs: null
  };

  try {
    workerProcess = spawn(pythonBin, [workerPath, "--worker"], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (error) {
    workerStatus = {
      status: "error",
      pid: null,
      lastError: String(error),
      pythonStartupMs: null
    };
    throw new WorkerJobError("WORKER_START_FAILED", "Failed to start worker.");
  }

  workerStatus.pid = workerProcess.pid ?? null;
  attachListeners(workerProcess);
};

const attachListeners = (process: ChildProcessWithoutNullStreams) => {
  lineReader?.close();
  lineReader = readline.createInterface({ input: process.stdout });

  lineReader.on("line", (line) => {
    handleWorkerLine(line);
  });

  process.stderr.on("data", (chunk: Buffer) => {
    if (activeJob) {
      activeJob.stderrTail.append(chunk);
    }
  });

  process.on("error", (error) => {
    workerStatus = {
      status: "error",
      pid: process.pid ?? null,
      lastError: String(error),
      pythonStartupMs: workerStatus.pythonStartupMs
    };
    failActiveJob("WORKER_START_FAILED", "Worker failed to start.");
    clearProcess();
    restartIfQueued();
  });

  process.on("exit", () => {
    if (workerStatus.status !== "error") {
      workerStatus = {
        status: "stopped",
        pid: null,
        lastError: workerStatus.lastError,
        pythonStartupMs: workerStatus.pythonStartupMs
      };
    }
    failActiveJob("WORKER_CRASHED", "Worker exited unexpectedly.");
    clearProcess();
    restartIfQueued();
  });
};

const handleWorkerLine = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  if (activeJob) {
    activeJob.stdoutTail.append(`${trimmed}\n`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch (error) {
    return;
  }
  if (!isRecord(payload)) {
    return;
  }
  const event = typeof payload.event === "string" ? payload.event : payload.type;
  if (event === "ready") {
    const startupMs =
      typeof payload.pythonStartupMs === "number" ? payload.pythonStartupMs : null;
    workerStatus = {
      status: "ready",
      pid: workerProcess?.pid ?? null,
      lastError: null,
      pythonStartupMs: startupMs
    };
    flushQueue();
    return;
  }

  const jobId = typeof payload.jobId === "string" ? payload.jobId : undefined;
  const job = activeJob;
  if (!job || (jobId && jobId !== job.docId)) {
    return;
  }

  if (event === "progress") {
    job.onProgress?.({
      jobId,
      stage: typeof payload.stage === "string" ? payload.stage : undefined,
      message: typeof payload.message === "string" ? payload.message : undefined,
      progress:
        typeof payload.progress === "number" ? payload.progress : undefined
    });
    return;
  }

  if (event === "result") {
    const exitCode = typeof payload.exitCode === "number" ? payload.exitCode : 1;
    resolveActiveJob(exitCode);
  }
};

const flushQueue = () => {
  if (!workerProcess || workerStatus.status !== "ready" || activeJob) {
    return;
  }
  const next = jobQueue.shift();
  if (!next) {
    return;
  }
  activeJob = next;
  sendJob(next);
};

const sendJob = (job: WorkerJob) => {
  const timeoutHandle = setTimeout(() => {
    job.timedOut = true;
    resolveActiveJob(-1, true);
    if (workerProcess && !workerProcess.killed) {
      workerProcess.kill("SIGKILL");
    }
  }, job.timeoutMs);
  job.timeoutHandle = timeoutHandle;

  const payload = {
    type: "job",
    jobId: job.docId,
    docId: job.docId,
    input: job.inputPath,
    dataDir: job.dataDir,
    gates: job.gatesPath,
    doclingConfig: job.doclingConfigPath,
    deviceOverride: job.deviceOverride ?? undefined,
    requestId: job.requestId
  };

  try {
    workerProcess?.stdin.write(JSON.stringify(payload) + "\n");
  } catch (error) {
    clearTimeout(timeoutHandle);
    job.timeoutHandle = null;
    job.reject(new WorkerJobError("WORKER_PROTOCOL", "Failed to send job to worker."));
    activeJob = null;
  }
};

const resolveActiveJob = (exitCode: number, timedOut = false) => {
  if (!activeJob) {
    return;
  }
  const job = activeJob;
  activeJob = null;
  if (job.timeoutHandle) {
    clearTimeout(job.timeoutHandle);
  }
  job.resolve({
    exitCode,
    stdoutTail: job.stdoutTail.toString(),
    stderrTail: job.stderrTail.toString(),
    timedOut
  });
  flushQueue();
};

const failActiveJob = (
  code: WorkerJobError["code"],
  message: string
) => {
  if (!activeJob) {
    return;
  }
  const job = activeJob;
  activeJob = null;
  if (job.timeoutHandle) {
    clearTimeout(job.timeoutHandle);
  }
  job.reject(new WorkerJobError(code, message));
};

const clearProcess = () => {
  lineReader?.close();
  lineReader = null;
  workerProcess = null;
  workerKey = "";
};

const restartIfQueued = () => {
  if (!jobQueue.length || !lastStartOptions) {
    return;
  }
  try {
    ensureWorker(lastStartOptions.pythonBin, lastStartOptions.workerPath);
  } catch (error) {
    rejectQueuedJobs(
      new WorkerJobError("WORKER_START_FAILED", "Failed to restart worker.")
    );
    return;
  }
  flushQueue();
};

const rejectQueuedJobs = (error: WorkerJobError) => {
  while (jobQueue.length > 0) {
    const job = jobQueue.shift();
    if (job) {
      job.reject(error);
    }
  }
};

const createTailBuffer = (maxBytes: number): TailBuffer => {
  let buffer = Buffer.alloc(0);
  return {
    append(chunk) {
      if (maxBytes <= 0) {
        return;
      }
      const next = typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : chunk;
      buffer = Buffer.concat([buffer, next]);
      if (buffer.length > maxBytes) {
        buffer = buffer.subarray(buffer.length - maxBytes);
      }
    },
    toString() {
      return buffer.toString("utf-8");
    }
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
