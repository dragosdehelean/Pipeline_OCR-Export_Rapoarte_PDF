"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusBadge } from "./StatusBadge";

type HealthConfig = {
  accept: {
    mimeTypes: string[];
    extensions: string[];
  };
  limits: {
    maxFileSizeMb: number;
    maxPages: number;
    processTimeoutSec: number;
  };
};

type HealthState = {
  loading: boolean;
  ok: boolean;
  missingEnv: string[];
  config: HealthConfig | null;
  configError: string | null;
};

type UploadNotice = {
  id: string;
  name: string;
  status: "SUCCESS" | "FAILED" | "PENDING";
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

export default function UploadForm() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [lastUpload, setLastUpload] = useState<UploadNotice | null>(null);
  const [health, setHealth] = useState<HealthState>({
    loading: true,
    ok: false,
    missingEnv: [],
    config: null,
    configError: null
  });

  useEffect(() => {
    let active = true;
    const checkHealth = async () => {
      try {
        const response = await fetch("/api/health");
        const payload = (await response.json()) as {
          ok?: boolean;
          missingEnv?: string[];
          config?: HealthConfig | null;
          configError?: string | null;
        };
        if (!active) {
          return;
        }
        setHealth({
          loading: false,
          ok: payload.ok === true,
          missingEnv: Array.isArray(payload.missingEnv) ? payload.missingEnv : [],
          config: payload.config ?? null,
          configError: payload.configError ?? null
        });
      } catch (err) {
        if (!active) {
          return;
        }
        setHealth({
          loading: false,
          ok: false,
          missingEnv: [],
          config: null,
          configError: null
        });
      }
    };

    checkHealth();
    return () => {
      active = false;
    };
  }, []);

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

  const handleUpload = async (file: File | null) => {
    if (health.loading || !health.ok) {
      return;
    }

    if (!file) {
      const baseMessage = "Select a file first";
      const detail = acceptLabel !== "Not available" ? ` (allowed: ${acceptLabel}).` : ".";
      setError(`${baseMessage}${detail}`);
      return;
    }

    const typeError = getFileTypeError(file, acceptExtensions, acceptMimeTypes);
    if (typeError) {
      setError(`${typeError} Allowed: ${acceptLabel}.`);
      return;
    }

    if (isFileTooLarge) {
      setError(fileSizeError ?? "File exceeds max size.");
      return;
    }

    setIsUploading(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/docs/upload", {
        method: "POST",
        body: formData
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload.code === "MISSING_ENV") {
          setHealth({
            loading: false,
            ok: false,
            missingEnv: Array.isArray(payload.missingEnv) ? payload.missingEnv : [],
            config: null,
            configError: null
          });
          setError(null);
          return;
        }
        setError(payload.error || "Upload failed.");
      } else {
        const status =
          payload.status === "FAILED" || payload.status === "PENDING"
            ? payload.status
            : "SUCCESS";
        setLastUpload({
          id: payload.id ?? "",
          name: payload.originalFileName ?? file.name,
          status
        });
        clearSelectedFile();
        router.refresh();
      }
    } catch (err) {
      setError("Upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await handleUpload(selectedFile);
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0] ?? null;
    setIsDragActive(false);
    setSelectedFile(file);
    setError(null);
    setLastUpload(null);
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isDragActive) {
      setIsDragActive(true);
    }
  };

  const onDragLeave = () => {
    setIsDragActive(false);
  };

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setError(null);
    setLastUpload(null);
  };

  const isReady = !health.loading && health.ok;
  const maxPages = health.config?.limits?.maxPages ?? null;
  const timeoutSec = health.config?.limits?.processTimeoutSec ?? null;
  const canUpload =
    isReady && !!selectedFile && !isUploading && !isFileTooLarge && !fileTypeError;

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
      {lastUpload ? (
        <div
          className={`alert ${lastUpload.status === "FAILED" ? "warning" : "success"}`}
          role="status"
        >
          <div className="alert-title">
            {lastUpload.status === "FAILED" ? "Processed with issues" : "Upload complete"}
          </div>
          <div className="alert-row">
            <StatusBadge status={lastUpload.status} />
            <div>{lastUpload.name}</div>
          </div>
          {lastUpload.id ? (
            <div className="alert-actions">
              <Link className="button ghost" href={`/docs/${lastUpload.id}`}>
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
      {error ? (
        <div className="alert error" role="alert">
          {error}
        </div>
      ) : null}
    </form>
  );
}
