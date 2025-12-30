"use client";

/**
 * @fileoverview Markdown/JSON preview tabs with copy support.
 */
import { useEffect, useMemo, useRef, useState } from "react";

type PreviewProps = {
  markdown?: string | null;
  json?: string | null;
};

type CopyState = "idle" | "copied" | "error";

function formatJson(value?: string | null) {
  if (!value) {
    return null;
  }
  try {
    return `${JSON.stringify(JSON.parse(value), null, 2)}\n`;
  } catch (error) {
    return value;
  }
}

async function copyToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  if (typeof document === "undefined") {
    return false;
  }

  // WHY: Use execCommand fallback when Clipboard API is unavailable.
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  return ok;
}

/**
 * Renders markdown and JSON previews with copy actions.
 */
export default function PreviewTabs({ markdown, json }: PreviewProps) {
  const [active, setActive] = useState<"markdown" | "json">(
    markdown ? "markdown" : "json"
  );
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimeout = useRef<number | null>(null);
  const formattedJson = useMemo(() => formatJson(json), [json]);

  const hasContent = Boolean(markdown || json);
  const activeText = active === "markdown" ? markdown : formattedJson;
  const copyLabel =
    copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy";

  const handleCopy = async () => {
    if (!activeText) {
      return;
    }
    try {
      const ok = await copyToClipboard(activeText);
      setCopyState(ok ? "copied" : "error");
    } catch (error) {
      setCopyState("error");
    }
    if (resetTimeout.current) {
      window.clearTimeout(resetTimeout.current);
    }
    resetTimeout.current = window.setTimeout(() => {
      setCopyState("idle");
    }, 1500);
  };

  useEffect(() => {
    setCopyState("idle");
  }, [active]);

  useEffect(() => {
    return () => {
      if (resetTimeout.current) {
        window.clearTimeout(resetTimeout.current);
      }
    };
  }, []);

  if (!hasContent) {
    return <div className="note">No exports available for preview.</div>;
  }

  return (
    <div className="grid">
      <div className="tabs">
        {markdown ? (
          <button
            className={`tab-button ${active === "markdown" ? "active" : ""}`}
            onClick={() => setActive("markdown")}
            type="button"
          >
            Markdown
          </button>
        ) : null}
        {json ? (
          <button
            className={`tab-button ${active === "json" ? "active" : ""}`}
            onClick={() => setActive("json")}
            type="button"
          >
            JSON
          </button>
        ) : null}
      </div>
      <div className="preview-panel">
        <div className="preview-toolbar">
          <button
            className="button ghost preview-copy"
            onClick={handleCopy}
            type="button"
            disabled={!activeText}
          >
            {copyLabel}
          </button>
        </div>
        {active === "markdown" && markdown ? (
          <pre className="preview-pre">{markdown}</pre>
        ) : null}
        {active === "json" && formattedJson ? (
          <pre className="preview-pre">{formattedJson}</pre>
        ) : null}
      </div>
    </div>
  );
}
