"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type HealthState = {
  loading: boolean;
  ok: boolean;
  missingEnv: string[];
};

export default function UploadForm() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthState>({
    loading: true,
    ok: false,
    missingEnv: []
  });

  useEffect(() => {
    let active = true;
    const checkHealth = async () => {
      try {
        const response = await fetch("/api/health");
        const payload = (await response.json()) as {
          ok?: boolean;
          missingEnv?: string[];
        };
        if (!active) {
          return;
        }
        setHealth({
          loading: false,
          ok: payload.ok === true,
          missingEnv: Array.isArray(payload.missingEnv) ? payload.missingEnv : []
        });
      } catch (err) {
        if (!active) {
          return;
        }
        setHealth({ loading: false, ok: false, missingEnv: [] });
      }
    };

    checkHealth();
    return () => {
      active = false;
    };
  }, []);

  const handleUpload = async (file: File | null) => {
    if (health.loading || !health.ok) {
      return;
    }

    if (!file) {
      setError("Select a file first.");
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

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (payload.code === "MISSING_ENV") {
          setHealth({
            loading: false,
            ok: false,
            missingEnv: Array.isArray(payload.missingEnv) ? payload.missingEnv : []
          });
          setError(null);
          return;
        }
        setError(payload.error || "Upload failed.");
      } else {
        if (inputRef.current) {
          inputRef.current.value = "";
        }
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
    await handleUpload(inputRef.current?.files?.[0] ?? null);
  };

  const onDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0] ?? null;
    await handleUpload(file);
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const isReady = !health.loading && health.ok;

  return (
    <form className="upload-zone" onSubmit={onSubmit}>
      {!health.loading && !health.ok ? (
        <div className="alert error" role="alert">
          <div className="alert-title">Setup required</div>
          <div>Complete the local env setup before uploading files.</div>
          <ul className="alert-list">
            <li>Copy `.env.local.example` → `.env.local`</li>
            <li>Complete `PYTHON_BIN` and `DOCLING_WORKER`</li>
            <li>Restart `npm run dev` after editing `.env.local`</li>
          </ul>
          {health.missingEnv.length > 0 ? (
            <div className="alert-note">
              Missing: {health.missingEnv.join(", ")}
            </div>
          ) : null}
        </div>
      ) : null}
      <div>
        <strong>Upload PDF/DOCX</strong>
        <div className="note">Docling-only, strict quality gates.</div>
      </div>
      <div onDrop={onDrop} onDragOver={onDragOver}>
        <input ref={inputRef} type="file" name="file" accept=".pdf,.docx" />
      </div>
      <button className="button" type="submit" disabled={isUploading || !isReady}>
        {isUploading ? "Uploading..." : "Upload"}
      </button>
      {error ? <div className="note">{error}</div> : null}
    </form>
  );
}
