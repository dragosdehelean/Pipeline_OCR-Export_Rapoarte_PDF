/**
 * @fileoverview Manages a keep-warm Docling worker process using JSONL IPC.
 */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type * as readline from "node:readline";

export type WorkerStatusSnapshot = {
  status: "stopped" | "starting" | "ready" | "error";
  pid: number | null;
  lastError: string | null;
  pythonStartupMs: number | null;
  prewarm: WorkerPrewarmInfo | null;
};

export type WorkerPrewarmInfo = {
  profile: string;
  requestedDevice: string;
  effectiveDevice: string;
  cudaAvailable: boolean;
  reason?: string;
};

export type DoclingCapabilities = {
  doclingVersion: string;
  pdfBackends: string[];
  tableModes: string[];
  tableStructureOptionsFields?: string[];
  cudaAvailable?: boolean | null;
  gpuName?: string | null;
  torchVersion?: string | null;
  torchCudaVersion?: string | null;
};

export type DoclingJobProof = {
  docId: string;
  requested: Record<string, unknown>;
  effective: Record<string, unknown>;
  fallbackReasons?: string[];
};

export type DoclingWorkerSnapshot = {
  capabilities: DoclingCapabilities | null;
  lastJob: DoclingJobProof | null;
  error?: string;
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
  workerReused: boolean;
  spawnedThisRequest: boolean;
  pythonStartupMs: number | null;
};

/**
 * Describes a ready worker handle alongside spawn context.
 */
export type WorkerHandle = {
  worker: ChildProcessWithoutNullStreams;
  workerReused: boolean;
  spawnedThisCall: boolean;
  pythonStartupMs: number | null;
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
  pymupdfConfigPath: string;
  engine?: "docling" | "pymupdf4llm" | "pymupdf_text";
  layoutMode?: "layout" | "standard" | null;
  deviceOverride?: string | null;
  profile?: string | null;
  requestId: string;
  timeoutMs: number;
  stdoutTailBytes: number;
  stderrTailBytes: number;
  onProgress?: (update: WorkerProgressUpdate) => void;
};

type WorkerStartOptions = {
  pythonBin: string;
  workerPath: string;
  timeoutMs?: number;
};

type WorkerJobStartup = {
  workerReused: boolean;
  spawnedThisRequest: boolean;
  pythonStartupMs: number | null;
};

type WorkerJob = WorkerJobOptions & {
  resolve: (result: WorkerJobResult) => void;
  reject: (error: WorkerJobError) => void;
  stdoutTail: TailBuffer;
  stderrTail: TailBuffer;
  timedOut: boolean;
  timeoutHandle: NodeJS.Timeout | null;
  workerReused: boolean;
  spawnedThisRequest: boolean;
  pythonStartupMs: number | null;
};

type TailBuffer = {
  append: (chunk: Buffer | string) => void;
  toString: () => string;
};

type WorkerState = {
  workerProcess: ChildProcessWithoutNullStreams | null;
  workerStatus: WorkerStatusSnapshot;
  workerKey: string;
  lastStartOptions: { pythonBin: string; workerPath: string } | null;
  lineReader: readline.Interface | null;
  activeJob: WorkerJob | null;
  jobQueue: WorkerJob[];
  startPromise: Promise<WorkerStatusSnapshot> | null;
  startResolve: ((value: WorkerStatusSnapshot) => void) | null;
  startReject: ((error: WorkerJobError) => void) | null;
  shutdownHandlersRegistered: boolean;
  capabilitiesRequest: {
    requestId: string;
    resolve: (value: DoclingWorkerSnapshot) => void;
    reject: (error: WorkerJobError) => void;
    timeoutHandle: NodeJS.Timeout | null;
  } | null;
};

const getWorkerState = (): WorkerState => {
  const globalState = globalThis as typeof globalThis & { __DOC_WORKER__?: WorkerState };
  if (!globalState.__DOC_WORKER__) {
    globalState.__DOC_WORKER__ = {
      workerProcess: null,
      workerStatus: {
        status: "stopped",
        pid: null,
        lastError: null,
        pythonStartupMs: null,
        prewarm: null
      },
      workerKey: "",
      lastStartOptions: null,
      lineReader: null,
      activeJob: null,
      jobQueue: [],
      startPromise: null,
      startResolve: null,
      startReject: null,
      shutdownHandlersRegistered: false,
      capabilitiesRequest: null
    };
  }
  return globalState.__DOC_WORKER__;
};

const state = getWorkerState();

type WorkerDeps = {
  spawn: typeof import("node:child_process").spawn;
  readline: typeof import("node:readline");
};

let workerDepsPromise: Promise<WorkerDeps> | null = null;
const DEFAULT_STARTUP_TIMEOUT_MS = 30000;
const DEFAULT_CAPABILITIES_TIMEOUT_MS = 2000;
let capabilitiesRequestCounter = 0;

const loadWorkerDeps = async (): Promise<WorkerDeps> => {
  if (!workerDepsPromise) {
    workerDepsPromise = Promise.all([
      import(/* webpackIgnore: true */ "node:child_process"),
      import(/* webpackIgnore: true */ "node:readline")
    ]).then(([childProcess, readline]) => ({
      spawn: childProcess.spawn,
      readline
    }));
  }
  return workerDepsPromise;
};

/**
 * Returns a snapshot of the current worker status for health reporting.
 */
export function getWorkerStatus(): WorkerStatusSnapshot {
  return { ...state.workerStatus };
}

/**
 * Starts the Docling worker in advance to avoid per-request spawn costs.
 */
export async function prewarmWorker(options: WorkerStartOptions): Promise<void> {
  await getWorker(options);
}

/**
 * Returns a ready worker handle with spawn context for telemetry.
 */
export async function getWorker(options: WorkerStartOptions): Promise<WorkerHandle> {
  registerWorkerShutdownHandlers();
  const { pythonBin, workerPath } = options;
  const nextKey = `${pythonBin}::${workerPath}`;
  const isReady =
    state.workerProcess &&
    state.workerKey === nextKey &&
    state.workerStatus.status === "ready";
  if (isReady && state.workerProcess) {
    return {
      worker: state.workerProcess,
      workerReused: true,
      spawnedThisCall: false,
      pythonStartupMs: null
    };
  }

  const spawnedThisCall = await startWorkerIfNeeded(pythonBin, workerPath);
  const startPromise = state.startPromise;
  if (startPromise) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    await waitForWorkerReady(startPromise, timeoutMs);
  } else if (state.workerStatus.status !== "ready") {
    throw new WorkerJobError(
      "WORKER_START_FAILED",
      "Worker did not become ready."
    );
  }

  if (!state.workerProcess) {
    throw new WorkerJobError("WORKER_START_FAILED", "Worker is not available.");
  }

  return {
    worker: state.workerProcess,
    workerReused: !spawnedThisCall,
    spawnedThisCall,
    pythonStartupMs: spawnedThisCall ? state.workerStatus.pythonStartupMs : null
  };
}

/**
 * Enqueues a Docling job and resolves once the worker finishes processing.
 */
export async function submitWorkerJob(options: WorkerJobOptions): Promise<WorkerJobResult> {
  const startup = await getWorker({
    pythonBin: options.pythonBin,
    workerPath: options.workerPath
  });
  return enqueueJob({
    ...options,
    workerReused: startup.workerReused,
    spawnedThisRequest: startup.spawnedThisCall,
    pythonStartupMs: startup.pythonStartupMs
  });
}

/**
 * Requests Docling capabilities and last job info from the worker.
 */
export async function getWorkerCapabilities(options: {
  pythonBin: string;
  workerPath: string;
  timeoutMs?: number;
}): Promise<DoclingWorkerSnapshot> {
  try {
    await getWorker({ pythonBin: options.pythonBin, workerPath: options.workerPath });
  } catch (error) {
    return {
      capabilities: null,
      lastJob: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  if (state.capabilitiesRequest) {
    return {
      capabilities: null,
      lastJob: null,
      error: "Capabilities request already in flight."
    };
  }

  const requestId = `cap-${capabilitiesRequestCounter++}`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_CAPABILITIES_TIMEOUT_MS;

  return new Promise<DoclingWorkerSnapshot>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      if (state.capabilitiesRequest?.requestId !== requestId) {
        return;
      }
      state.capabilitiesRequest = null;
      reject(new WorkerJobError("WORKER_PROTOCOL", "Capabilities request timed out."));
    }, timeoutMs);

    state.capabilitiesRequest = {
      requestId,
      resolve,
      reject,
      timeoutHandle
    };

    try {
      state.workerProcess?.stdin.write(
        JSON.stringify({ type: "capabilities", requestId }) + "\n"
      );
    } catch (error) {
      clearTimeout(timeoutHandle);
      state.capabilitiesRequest = null;
      reject(new WorkerJobError("WORKER_PROTOCOL", "Failed to request capabilities."));
    }
  }).catch((error): DoclingWorkerSnapshot => ({
    capabilities: null,
    lastJob: null,
    error: error instanceof Error ? error.message : String(error)
  }));
}

/**
 * Shuts down the keep-warm worker process, if running.
 */
export async function shutdownWorker(): Promise<void> {
  const process = state.workerProcess;
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

/**
 * Registers process signal handlers to stop the worker on shutdown.
 */
export function registerWorkerShutdownHandlers(): void {
  if (state.shutdownHandlersRegistered) {
    return;
  }
  state.shutdownHandlersRegistered = true;
  const handleShutdown = () => {
    void shutdownWorker();
  };
  process.once("SIGINT", handleShutdown);
  process.once("SIGTERM", handleShutdown);
  process.once("beforeExit", handleShutdown);
}

/**
 * Returns whether shutdown handlers are already registered (test helper).
 */
export function getShutdownHandlersRegisteredForTests(): boolean {
  return state.shutdownHandlersRegistered;
}


const waitForWorkerReady = (
  startPromise: Promise<WorkerStatusSnapshot>,
  timeoutMs: number
): Promise<WorkerStatusSnapshot> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(
        new WorkerJobError("WORKER_START_FAILED", "Worker did not become ready.")
      );
    }, timeoutMs);

    startPromise
      .then((status) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(status);
      })
      .catch((error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
  });

const resolveStartPromise = () => {
  if (!state.startResolve || !state.startPromise) {
    return;
  }
  state.startResolve(state.workerStatus);
  state.startPromise = null;
  state.startResolve = null;
  state.startReject = null;
};

const rejectStartPromise = (error: WorkerJobError) => {
  if (!state.startReject || !state.startPromise) {
    return;
  }
  state.startReject(error);
  state.startPromise = null;
  state.startResolve = null;
  state.startReject = null;
};

const enqueueJob = (options: WorkerJobOptions & WorkerJobStartup): Promise<WorkerJobResult> =>
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
    state.jobQueue.push(job);
    flushQueue();
  });

const startWorkerIfNeeded = async (
  pythonBin: string,
  workerPath: string
): Promise<boolean> => {
  const nextKey = `${pythonBin}::${workerPath}`;
  if (state.workerProcess && state.workerKey !== nextKey) {
    await shutdownWorker();
  }
  if (state.workerProcess) {
    return false;
  }
  if (state.startPromise && state.workerKey === nextKey) {
    return false;
  }

  state.workerKey = nextKey;
  state.lastStartOptions = { pythonBin, workerPath };
  state.workerStatus = {
    status: "starting",
    pid: null,
    lastError: null,
    pythonStartupMs: null,
    prewarm: null
  };
  state.startPromise = new Promise((resolve, reject) => {
    state.startResolve = resolve;
    state.startReject = reject;
  });

  const { spawn, readline } = await loadWorkerDeps();

  try {
    state.workerProcess = spawn(pythonBin, [workerPath, "--worker"], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (error) {
    state.workerStatus = {
      status: "error",
      pid: null,
      lastError: String(error),
      pythonStartupMs: null,
      prewarm: null
    };
    state.startReject?.(
      new WorkerJobError("WORKER_START_FAILED", "Failed to start worker.")
    );
    state.startPromise = null;
    state.startResolve = null;
    state.startReject = null;
    throw new WorkerJobError("WORKER_START_FAILED", "Failed to start worker.");
  }

  state.workerStatus.pid = state.workerProcess.pid ?? null;
  attachListeners(state.workerProcess, readline);
  return true;
};

const attachListeners = (
  process: ChildProcessWithoutNullStreams,
  readlineModule: WorkerDeps["readline"]
) => {
  state.lineReader?.close();
  state.lineReader = readlineModule.createInterface({ input: process.stdout });

  state.lineReader.on("line", (line: string) => {
    handleWorkerLine(line);
  });

  process.stderr.on("data", (chunk: Buffer) => {
    if (state.activeJob) {
      state.activeJob.stderrTail.append(chunk);
    }
  });

  process.on("error", (error) => {
    state.workerStatus = {
      status: "error",
      pid: process.pid ?? null,
      lastError: String(error),
      pythonStartupMs: state.workerStatus.pythonStartupMs,
      prewarm: state.workerStatus.prewarm
    };
    rejectStartPromise(
      new WorkerJobError("WORKER_START_FAILED", "Worker failed to start.")
    );
    failActiveJob("WORKER_START_FAILED", "Worker failed to start.");
    clearProcess();
    void restartIfQueued();
  });

  process.on("exit", () => {
    if (state.workerStatus.status !== "error") {
      state.workerStatus = {
        status: "stopped",
        pid: null,
        lastError: state.workerStatus.lastError,
        pythonStartupMs: state.workerStatus.pythonStartupMs,
        prewarm: state.workerStatus.prewarm
      };
    }
    rejectStartPromise(
      new WorkerJobError("WORKER_CRASHED", "Worker exited unexpectedly.")
    );
    failActiveJob("WORKER_CRASHED", "Worker exited unexpectedly.");
    clearProcess();
    void restartIfQueued();
  });
};

const handleWorkerLine = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  if (state.activeJob) {
    state.activeJob.stdoutTail.append(`${trimmed}\n`);
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
    state.workerStatus = {
      status: "ready",
      pid: state.workerProcess?.pid ?? null,
      lastError: null,
      pythonStartupMs: startupMs,
      prewarm: parsePrewarmInfo(payload.prewarm)
    };
    resolveStartPromise();
    flushQueue();
    return;
  }

  if (event === "capabilities") {
    const requestId = typeof payload.requestId === "string" ? payload.requestId : null;
    const pending = state.capabilitiesRequest;
    if (pending && requestId && pending.requestId === requestId) {
      if (pending.timeoutHandle) {
        clearTimeout(pending.timeoutHandle);
      }
      state.capabilitiesRequest = null;
      pending.resolve({
        capabilities: parseCapabilities(payload.capabilities),
        lastJob: parseLastJob(payload.lastJob)
      });
    }
    return;
  }

  const jobId = typeof payload.jobId === "string" ? payload.jobId : undefined;
  const job = state.activeJob;
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
  if (!state.workerProcess || state.workerStatus.status !== "ready" || state.activeJob) {
    return;
  }
  const next = state.jobQueue.shift();
  if (!next) {
    return;
  }
  state.activeJob = next;
  sendJob(next);
};

const sendJob = (job: WorkerJob) => {
  const timeoutHandle = setTimeout(() => {
    job.timedOut = true;
    resolveActiveJob(-1, true);
    if (state.workerProcess && !state.workerProcess.killed) {
      state.workerProcess.kill("SIGKILL");
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
    pymupdfConfig: job.pymupdfConfigPath,
    engine: job.engine ?? "docling",
    layoutMode: job.layoutMode ?? undefined,
    deviceOverride: job.deviceOverride ?? undefined,
    profile: job.profile ?? undefined,
    requestId: job.requestId
  };

  try {
    state.workerProcess?.stdin.write(JSON.stringify(payload) + "\n");
  } catch (error) {
    clearTimeout(timeoutHandle);
    job.timeoutHandle = null;
    job.reject(new WorkerJobError("WORKER_PROTOCOL", "Failed to send job to worker."));
    state.activeJob = null;
  }
};

const resolveActiveJob = (exitCode: number, timedOut = false) => {
  if (!state.activeJob) {
    return;
  }
  const job = state.activeJob;
  state.activeJob = null;
  if (job.timeoutHandle) {
    clearTimeout(job.timeoutHandle);
  }
  job.resolve({
    exitCode,
    stdoutTail: job.stdoutTail.toString(),
    stderrTail: job.stderrTail.toString(),
    timedOut,
    workerReused: job.workerReused,
    spawnedThisRequest: job.spawnedThisRequest,
    pythonStartupMs: job.spawnedThisRequest ? job.pythonStartupMs : null
  });
  flushQueue();
};

const failActiveJob = (
  code: WorkerJobError["code"],
  message: string
) => {
  if (!state.activeJob) {
    return;
  }
  const job = state.activeJob;
  state.activeJob = null;
  if (job.timeoutHandle) {
    clearTimeout(job.timeoutHandle);
  }
  job.reject(new WorkerJobError(code, message));
};

const clearProcess = () => {
  state.lineReader?.close();
  state.lineReader = null;
  state.workerProcess = null;
  state.workerKey = "";
  if (state.capabilitiesRequest?.timeoutHandle) {
    clearTimeout(state.capabilitiesRequest.timeoutHandle);
  }
  if (state.capabilitiesRequest) {
    state.capabilitiesRequest.reject(
      new WorkerJobError("WORKER_PROTOCOL", "Worker unavailable for capabilities.")
    );
  }
  state.capabilitiesRequest = null;
};

const restartIfQueued = async () => {
  if (!state.jobQueue.length || !state.lastStartOptions) {
    return;
  }
  try {
    await startWorkerIfNeeded(
      state.lastStartOptions.pythonBin,
      state.lastStartOptions.workerPath
    );
  } catch (error) {
    rejectQueuedJobs(
      new WorkerJobError("WORKER_START_FAILED", "Failed to restart worker.")
    );
    return;
  }
  flushQueue();
};

const rejectQueuedJobs = (error: WorkerJobError) => {
  while (state.jobQueue.length > 0) {
    const job = state.jobQueue.shift();
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

const parsePrewarmInfo = (value: unknown): WorkerPrewarmInfo | null => {
  if (!isRecord(value)) {
    return null;
  }
  const profile = typeof value.profile === "string" ? value.profile : null;
  const requestedDevice =
    typeof value.requestedDevice === "string" ? value.requestedDevice : null;
  const effectiveDevice =
    typeof value.effectiveDevice === "string" ? value.effectiveDevice : null;
  const cudaAvailable =
    typeof value.cudaAvailable === "boolean" ? value.cudaAvailable : null;
  if (!profile || !requestedDevice || !effectiveDevice || cudaAvailable === null) {
    return null;
  }
  return {
    profile,
    requestedDevice,
    effectiveDevice,
    cudaAvailable,
    reason: typeof value.reason === "string" ? value.reason : undefined
  };
};

const parseCapabilities = (value: unknown): DoclingCapabilities | null => {
  if (!isRecord(value)) {
    return null;
  }
  const doclingVersion =
    typeof value.doclingVersion === "string" ? value.doclingVersion : null;
  const pdfBackends = Array.isArray(value.pdfBackends)
    ? value.pdfBackends.filter((item) => typeof item === "string")
    : null;
  const tableModes = Array.isArray(value.tableModes)
    ? value.tableModes.filter((item) => typeof item === "string")
    : null;
  if (!doclingVersion || !pdfBackends || !tableModes) {
    return null;
  }
  return {
    doclingVersion,
    pdfBackends,
    tableModes,
    tableStructureOptionsFields: Array.isArray(value.tableStructureOptionsFields)
      ? value.tableStructureOptionsFields.filter((item) => typeof item === "string")
      : undefined,
    cudaAvailable: typeof value.cudaAvailable === "boolean" ? value.cudaAvailable : null,
    gpuName: typeof value.gpuName === "string" ? value.gpuName : null,
    torchVersion: typeof value.torchVersion === "string" ? value.torchVersion : null,
    torchCudaVersion:
      typeof value.torchCudaVersion === "string" ? value.torchCudaVersion : null
  };
};

const parseLastJob = (value: unknown): DoclingJobProof | null => {
  if (!isRecord(value)) {
    return null;
  }
  const docId = typeof value.docId === "string" ? value.docId : null;
  if (!docId || !isRecord(value.requested) || !isRecord(value.effective)) {
    return null;
  }
  return {
    docId,
    requested: value.requested,
    effective: value.effective,
    fallbackReasons: Array.isArray(value.fallbackReasons)
      ? value.fallbackReasons.filter((item) => typeof item === "string")
      : undefined
  };
};
