"use client";

import { useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "./StatusBadge";
import type { QualityGatesConfig } from "../_lib/config";
import { toDocMeta } from "../_lib/meta";
import { metaFileSchema, type DocMeta, type DocStatus, type MetaFile } from "../_lib/schema";

type HealthConfig = Pick<QualityGatesConfig, "accept"> & {
  limits: Pick<
    QualityGatesConfig["limits"],
    "maxFileSizeMb" | "maxPages" | "processTimeoutSec"
  >;
};

type HealthPayload = {
  ok?: boolean;
  missingEnv?: string[];
  config?: HealthConfig | null;
  configError?: string | null;
};

type UploadError = {
  message: string;
  requestId?: string;
  statusCode?: number;
  stage?: string;
  docId?: string;
};

type ProcessingState = {
  id: string;
  name: string;
  status: DocStatus;
  stage: string | null;
  message: string | null;
  progress: number | null;
};

type UploadPayload = Record<string, unknown>;

type UploadResult = {
  ok: boolean;
  status: number;
  payload: UploadPayload;
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function getFileExtension(fileName: string) {
  const index = fileName.lastIndexOf(".");
  if (index < 0) {
    return "";
  }
  return fileName.slice(index).toLowerCase();
}

function getFileTypeError(
  file: File | null,
  extensions: string[],
  mimeTypes: string[]
): string | null {
  if (!file || extensions.length === 0) {
    return null;
  }
  const extension = getFileExtension(file.name);
  const extensionAllowed = extensions.includes(extension);
  const mimeAllowed =
    mimeTypes.length === 0 || file.type.length === 0 || mimeTypes.includes(file.type);

  if (extensionAllowed && mimeAllowed) {
    return null;
  }

  return "Unsupported file type.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function fetchHealth(signal?: AbortSignal): Promise<HealthPayload> {
  const response = await fetch("/api/health", { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error("Unable to load health status.");
  }
  return (await response.json()) as HealthPayload;
}

async function fetchDocMeta(id: string, signal?: AbortSignal): Promise<MetaFile> {
  const response = await fetch(`/api/docs/${id}`, { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error("Unable to load document status.");
  }
  return metaFileSchema.parse(await response.json());
}

function normalizeUploadPayload(value: unknown): UploadPayload {
  return isRecord(value) ? value : {};
}

function updateDocsCache(current: DocMeta[] | undefined, next: DocMeta): DocMeta[] {
  const docs = Array.isArray(current) ? [...current] : [];
  const index = docs.findIndex((doc) => doc.id === next.id);
  if (index >= 0) {
    docs[index] = next;
  } else {
    docs.unshift(next);
  }
  return docs.slice(0, 200);
}

export default function UploadForm() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();
  const [error, setError] = useState<UploadError | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [activeDoc, setActiveDoc] = useState<ProcessingState | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const lastStatusRef = useRef<ProcessingState["status"] | null>(null);

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => fetchHealth(signal)
  });
  const healthPayload = healthQuery.data;
  const health = {
    loading: healthQuery.isPending,
    ok: healthPayload?.ok === true && !healthQuery.isError,
    missingEnv: Array.isArray(healthPayload?.missingEnv) ? healthPayload?.missingEnv : [],
    config: healthPayload?.config ?? null,
    configError: healthPayload?.configError ?? null
  };

  const acceptExtensions = health.config?.accept?.extensions ?? [];
  const acceptMimeTypes = health.config?.accept?.mimeTypes ?? [];
  const acceptLabel = acceptExtensions.length ? acceptExtensions.join(", ") : "Not available";
  const maxFileSizeMb = health.config?.limits?.maxFileSizeMb ?? null;
  const maxFileSizeBytes =
    maxFileSizeMb && Number.isFinite(maxFileSizeMb)
      ? maxFileSizeMb * 1024 * 1024
      : null;
  const isFileTooLarge =
    selectedFile && maxFileSizeBytes ? selectedFile.size > maxFileSizeBytes : false;
  const fileSizeError =
    isFileTooLarge && maxFileSizeMb
      ? `File exceeds max size (${maxFileSizeMb} MB).`
      : null;
  const fileTypeError = getFileTypeError(selectedFile, acceptExtensions, acceptMimeTypes);

  const clearSelectedFile = () => {
    setSelectedFile(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const uploadFile = (file: File) =>
    new Promise<UploadResult>((resolve, reject) => {
      const formData = new FormData();
      formData.append("file", file);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/docs/upload");
      xhr.responseType = "json";

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
          return;
        }
        const progress = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(progress);
      };

      xhr.onload = () => {
        let payload = normalizeUploadPayload(xhr.response);
        if (Object.keys(payload).length === 0 && typeof xhr.responseText === "string") {
          try {
            payload = normalizeUploadPayload(JSON.parse(xhr.responseText));
          } catch (parseError) {
            payload = {};
          }
        }
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          payload
        });
      };

      xhr.onerror = () => {
        reject(new Error("Upload failed."));
      };

      xhr.send(formData);
    });

  const uploadMutation = useMutation<UploadResult, Error, File>({
    mutationFn: uploadFile,
    onMutate: () => {
      setError(null);
      setUploadProgress(0);
      setActiveDoc(null);
      lastStatusRef.current = null;
    },
    onSuccess: ({ ok, payload, status }, file) => {
      if (!ok) {
        const errorPayload = isRecord(payload.error) ? payload.error : null;
        const errorCode = getString(errorPayload?.code) ?? getString(payload.code);
        if (errorCode === "MISSING_ENV") {
          queryClient.setQueryData(["health"], {
            ok: false,
            missingEnv: Array.isArray(payload.missingEnv)
              ? payload.missingEnv.filter((env) => typeof env === "string")
              : [],
            config: null,
            configError: null
          });
          setError(null);
          return;
        }
        setError({
          message:
            getString(errorPayload?.message) ||
            getString(payload.message) ||
            "Upload failed. Check the request ID for details.",
          requestId: getString(errorPayload?.requestId) ?? getString(payload.requestId),
          stage: getString(errorPayload?.stage) ?? getString(payload.stage),
          statusCode: status,
          docId: getString(payload.docId) ?? getString(payload.id)
        });
        return;
      }

      const statusValue = (() => {
        const statusRaw = getString(payload.status);
        if (statusRaw === "FAILED" || statusRaw === "SUCCESS" || statusRaw === "PENDING") {
          return statusRaw;
        }
        return "PENDING";
      })();
      const responseId = getString(payload.id) ?? getString(payload.docId) ?? "";
      if (!responseId) {
        setError({ message: "Upload response missing document id." });
        return;
      }
      setActiveDoc({
        id: responseId,
        name: getString(payload.originalFileName) ?? file.name,
        status: statusValue,
        stage: getString(payload.stage) ?? null,
        message: null,
        progress: getNumber(payload.progress) ?? null
      });
      clearSelectedFile();
      void queryClient.invalidateQueries({ queryKey: ["docs"] });
    },
    onError: () => {
      setError({ message: "Upload failed. Check the console for details." });
    },
    onSettled: () => {
      setUploadProgress(null);
    }
  });

  const isUploading = uploadMutation.isPending;

  const handleUpload = async (file: File | null) => {
    if (health.loading || !health.ok) {
      return;
    }

    if (!file) {
      const baseMessage = "Select a file first";
      const detail = acceptLabel !== "Not available" ? ` (allowed: ${acceptLabel}).` : ".";
      setError({ message: `${baseMessage}${detail}` });
      return;
    }

    const typeError = getFileTypeError(file, acceptExtensions, acceptMimeTypes);
    if (typeError) {
      setError({ message: `${typeError} Allowed: ${acceptLabel}.` });
      return;
    }

    if (isFileTooLarge) {
      setError({ message: fileSizeError ?? "File exceeds max size." });
      return;
    }

    try {
      await uploadMutation.mutateAsync(file);
    } catch (err) {
      setError({ message: "Upload failed. Check the console for details." });
    }
  };

  const docQuery = useQuery({
    queryKey: ["doc", activeDoc?.id ?? null],
    queryFn: ({ queryKey, signal }) => {
      const [, id] = queryKey;
      if (typeof id !== "string") {
        throw new Error("Missing document id.");
      }
      return fetchDocMeta(id, signal);
    },
    enabled: Boolean(activeDoc?.id),
    refetchInterval: (query) => {
      const status = query.state.data?.processing?.status;
      if (status === "FAILED" || status === "SUCCESS") {
        return false;
      }
      return 1500;
    },
    onSuccess: (meta) => {
      const docMeta = toDocMeta(meta);
      queryClient.setQueryData<DocMeta[]>(["docs"], (current) =>
        updateDocsCache(current, docMeta)
      );
      if (docMeta.status !== lastStatusRef.current) {
        lastStatusRef.current = docMeta.status;
        if (docMeta.status !== "PENDING") {
          void queryClient.invalidateQueries({ queryKey: ["docs"] });
        }
      }
    }
  });

  const processingState = useMemo(() => {
    if (!activeDoc) {
      return null;
    }
    if (!docQuery.data) {
      return activeDoc;
    }
    const meta = docQuery.data;
    const metaStatus = meta.processing?.status;
    const statusValue =
      metaStatus === "FAILED" || metaStatus === "SUCCESS" ? metaStatus : "PENDING";
    const progressValue = getNumber(meta.processing?.progress);
    return {
      id: activeDoc.id,
      name: meta.source?.originalFileName ?? activeDoc.name,
      status: statusValue,
      stage: meta.processing?.stage ?? activeDoc.stage,
      message: meta.processing?.message ?? null,
      progress: progressValue ?? activeDoc.progress
    };
  }, [activeDoc, docQuery.data]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await handleUpload(selectedFile);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0] ?? null;
    setIsDragActive(false);
    setSelectedFile(file);
    setError(null);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isDragActive) {
      setIsDragActive(true);
    }
  };

  const onDragLeave = () => {
    setIsDragActive(false);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setError(null);
  };

  const isReady = !health.loading && health.ok;
  const maxPages = health.config?.limits?.maxPages ?? null;
  const timeoutSec = health.config?.limits?.processTimeoutSec ?? null;
  const canUpload =
    isReady && !!selectedFile && !isUploading && !isFileTooLarge && !fileTypeError;

  const processingLabel = (() => {
    if (!processingState) {
      return null;
    }
    if (processingState.status === "FAILED") {
      return "Processing failed";
    }
    if (processingState.status === "SUCCESS") {
      return "Processing complete";
    }
    return "Processing in progress";
  })();

  const processingStage = processingState?.stage
    ? processingState.stage.replace(/_/g, " ")
    : null;

  return (
    <form
      className={`upload-zone ${isDragActive ? "drag-active" : ""}`}
      onSubmit={onSubmit}
    >
      {!health.loading && !health.ok ? (
        <div className="alert error" role="alert">
          <div className="alert-title">Setup required</div>
          <div>Complete the local env setup before uploading files.</div>
          <ul className="alert-list">
            <li>Copy `.env.local.example` to `.env.local`</li>
            <li>Set `PYTHON_BIN`, `DOCLING_WORKER`, `DATA_DIR`</li>
            <li>Set `GATES_CONFIG_PATH` to `config/quality-gates.json`</li>
            <li>Restart `npm run dev` after editing `.env.local`</li>
          </ul>
          {health.missingEnv.length > 0 ? (
            <div className="alert-note">
              Missing: {health.missingEnv.join(", ")}
            </div>
          ) : null}
          {health.configError ? (
            <div className="alert-note">Config error: {health.configError}</div>
          ) : null}
        </div>
      ) : null}
      <div className="upload-header">
        <strong>Upload PDF/DOCX</strong>
        <div className="note">Docling-only, strict quality gates.</div>
      </div>
      {processingState ? (
        <div
          className={`alert ${
            processingState.status === "FAILED"
              ? "error"
              : processingState.status === "SUCCESS"
                ? "success"
                : "warning"
          }`}
          role="status"
        >
          <div className="alert-title">{processingLabel}</div>
          <div className="alert-row">
            <StatusBadge status={processingState.status} />
            <div>{processingState.name}</div>
          </div>
          {processingStage ? <div className="note">Stage: {processingStage}</div> : null}
          {processingState.message ? (
            <div className="note">{processingState.message}</div>
          ) : null}
          {typeof processingState.progress === "number" ? (
            <div className="progress">
              <div className="progress-meta">
                {processingState.progress}% complete
              </div>
              <div className="progress-bar">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${processingState.progress}%` }}
                />
              </div>
            </div>
          ) : null}
          {processingState.id ? (
            <div className="alert-actions">
              <Link className="button ghost" href={`/docs/${processingState.id}`}>
                View details
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        className="upload-drop"
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        <label htmlFor="doc-file">Choose a file</label>
        <input
          ref={inputRef}
          id="doc-file"
          type="file"
          name="file"
          accept={acceptExtensions.join(",")}
          onChange={onFileChange}
        />
        <div className="note">Drag and drop a file here, or use the picker.</div>
      </div>
      {health.config ? (
        <div className="upload-requirements">
          <div>
            <span className="label">Allowed:</span> {acceptLabel}
          </div>
          {maxFileSizeMb ? (
            <div>
              <span className="label">Max file size:</span> {maxFileSizeMb} MB
            </div>
          ) : null}
          {maxPages ? (
            <div>
              <span className="label">Max pages:</span> {maxPages}
            </div>
          ) : null}
          {timeoutSec ? (
            <div>
              <span className="label">Timeout:</span> {timeoutSec}s
            </div>
          ) : null}
        </div>
      ) : null}
      {selectedFile ? (
        <div className="file-summary" data-testid="selected-file">
          <div>
            <div className="file-name">{selectedFile.name}</div>
            <div className="note">
              {formatBytes(selectedFile.size)}
              {selectedFile.type ? ` - ${selectedFile.type}` : ""}
            </div>
          </div>
          <button className="button ghost" type="button" onClick={clearSelectedFile}>
            Clear selection
          </button>
        </div>
      ) : null}
      {fileTypeError ? (
        <div className="alert warning" role="alert">
          {fileTypeError} Allowed: {acceptLabel}.
        </div>
      ) : null}
      {fileSizeError ? (
        <div className="alert warning" role="alert">
          {fileSizeError}
        </div>
      ) : null}
      <button className="button" type="submit" disabled={!canUpload}>
        {isUploading ? "Uploading..." : "Upload"}
      </button>
      {isUploading && uploadProgress !== null ? (
        <div className="progress" role="status">
          <div className="progress-meta">Uploading {uploadProgress}%</div>
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="alert error" role="alert">
          <div className="alert-title">Upload failed</div>
          <div>{error.message}</div>
          {error.stage ? <div className="note">Stage: {error.stage}</div> : null}
          {typeof error.statusCode === "number" ? (
            <div className="note">Status: {error.statusCode}</div>
          ) : null}
          {error.requestId ? (
            <div className="note">Request ID: {error.requestId}</div>
          ) : null}
          {error.docId ? (
            <div className="alert-actions">
              <Link className="button ghost" href={`/docs/${error.docId}`}>
                View details
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
