/**
 * @fileoverview Renders per-document detail pages with exports and metrics.
 */
import fs from "node:fs/promises";
import Link from "next/link";
import { notFound } from "next/navigation";
import PreviewTabs from "../../_components/PreviewTabs";
import { StatusBadge } from "../../_components/StatusBadge";
import { resolveStatus } from "../../_lib/meta";
import { getJsonPath, getMarkdownPath, readMetaFile } from "../../_lib/storage";
import type { FailedGate, MetaFile, QualityGateEvaluation } from "../../_lib/schema";

export const runtime = "nodejs";

function formatDateTime(value?: string | null) {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "n/a";
  }
  return date.toLocaleString();
}

function formatBytes(bytes?: number | string | null) {
  const numeric = Number(bytes);
  if (!numeric || !Number.isFinite(numeric)) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = numeric;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function formatNumber(value?: number | string | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  return new Intl.NumberFormat().format(numeric);
}

function formatProgress(value?: number | string | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }
  return `${numeric}%`;
}

/**
 * Loads meta and export previews for a single document.
 */
export default async function DocDetailsPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let meta: MetaFile;
  try {
    meta = await readMetaFile(id);
  } catch (error) {
    notFound();
  }

  const markdown = await readOptionalFile(getMarkdownPath(id));
  const jsonExport = await readOptionalFile(getJsonPath(id));

  const failedGates: FailedGate[] = meta.qualityGates?.failedGates ?? [];
  const evaluated: QualityGateEvaluation[] = meta.qualityGates?.evaluated ?? [];
  const warningGates = evaluated.filter(
    (gate) => gate.severity === "WARN" && !gate.passed
  );
  const status = resolveStatus(meta, failedGates);

  const hasMarkdown = Boolean(meta.outputs?.markdownPath);
  const hasJson = Boolean(meta.outputs?.jsonPath);
  const docId = meta.id ?? id;

  return (
    <div className="container">
      <header className="header">
        <Link className="ghost-link" href="/">
          Back to documents
        </Link>
        <h1>{meta.source?.originalFileName ?? id}</h1>
        <p>Document details and exports.</p>
      </header>

      <section className="card grid">
        <div className="summary-header">
          <StatusBadge status={status} />
        </div>

        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-label">Pages</div>
            <div className="metric-value">{formatNumber(meta.metrics?.pages)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Text chars</div>
            <div className="metric-value">{formatNumber(meta.metrics?.textChars)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Markdown chars</div>
            <div className="metric-value">{formatNumber(meta.metrics?.mdChars)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Text items</div>
            <div className="metric-value">{formatNumber(meta.metrics?.textItems)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Tables</div>
            <div className="metric-value">{formatNumber(meta.metrics?.tables)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Chars/page avg</div>
            <div className="metric-value">
              {formatNumber(meta.metrics?.textCharsPerPageAvg)}
            </div>
          </div>
        </div>

        <div className="meta-grid">
          <div>
            <div className="label">ID</div>
            <div>{docId}</div>
          </div>
          <div>
            <div className="label">Created</div>
            <div>{formatDateTime(meta.createdAt)}</div>
          </div>
          <div>
            <div className="label">Mime type</div>
            <div>{meta.source?.mimeType ?? "n/a"}</div>
          </div>
          <div>
            <div className="label">Size</div>
            <div>{formatBytes(meta.source?.sizeBytes)}</div>
          </div>
          <div>
            <div className="label">SHA-256</div>
            <div className="mono">{meta.source?.sha256 ?? "n/a"}</div>
          </div>
        </div>

        <div className="meta-grid">
          <div>
            <div className="label">Processing status</div>
            <div>{meta.processing?.status ?? "n/a"}</div>
          </div>
          <div>
            <div className="label">Exit code</div>
            <div>{meta.processing?.exitCode ?? "n/a"}</div>
          </div>
          <div>
            <div className="label">Duration</div>
            <div>{formatNumber(meta.processing?.durationMs)} ms</div>
          </div>
          <div>
            <div className="label">Started</div>
            <div>{formatDateTime(meta.processing?.startedAt)}</div>
          </div>
          <div>
            <div className="label">Finished</div>
            <div>{formatDateTime(meta.processing?.finishedAt)}</div>
          </div>
          <div>
            <div className="label">Stage</div>
            <div>{meta.processing?.stage ?? "n/a"}</div>
          </div>
          <div>
            <div className="label">Progress</div>
            <div>{formatProgress(meta.processing?.progress)}</div>
          </div>
          <div>
            <div className="label">Request ID</div>
            <div>{meta.processing?.requestId ?? meta.requestId ?? "n/a"}</div>
          </div>
        </div>
        {meta.processing?.message ? (
          <div className="note">Message: {meta.processing.message}</div>
        ) : null}
      </section>

      <section className="card grid">
        <h2>Quality gates</h2>
        <div className="chip-row">
          {meta.qualityGates?.configVersion ? (
            <span className="chip">Config v{meta.qualityGates.configVersion}</span>
          ) : null}
          <span className="chip">Strict: {meta.qualityGates?.strict ? "yes" : "no"}</span>
          <span className="chip">Failed: {failedGates.length}</span>
          <span className="chip">Warnings: {warningGates.length}</span>
          <span className="chip">Evaluated: {evaluated.length}</span>
        </div>
        {failedGates.length === 0 ? (
          <div className="note">No failed gates reported.</div>
        ) : (
          <div className="grid">
            <h3>Failed gates</h3>
            <div className="list">
              {failedGates.map((gate) => (
                <div className="list-item" key={gate.code}>
                  <strong>{gate.code}</strong>
                  <div className="note">{gate.message ?? "No details provided."}</div>
                  <div className="meta-row">
                    <span>Actual: {gate.actual}</span>
                    <span>Expected: {gate.expectedOp} {gate.expected}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {warningGates.length > 0 ? (
          <div className="grid">
            <h3>Warnings</h3>
            <div className="list">
              {warningGates.map((gate) => (
                <div className="list-item" key={gate.code}>
                  <strong>{gate.code}</strong>
                  <div className="note">{gate.message}</div>
                  <div className="meta-row">
                    <span>Actual: {gate.actual}</span>
                    <span>
                      Expected: {gate.op ?? gate.expectedOp ?? "?"} {gate.threshold ?? gate.expected ?? "?"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {status === "FAILED" && failedGates.length === 0 ? (
          <div className="note">Processing failed. Check logs below.</div>
        ) : null}
      </section>

      <section className="card grid">
        <h2>Exports</h2>
        {hasMarkdown || hasJson ? (
          <div className="export-actions">
            {hasMarkdown ? (
              <a className="button ghost" href={`/api/docs/${docId}/md`} download>
                Download Markdown
              </a>
            ) : null}
            {hasJson ? (
              <a className="button ghost" href={`/api/docs/${docId}/json`} download>
                Download JSON
              </a>
            ) : null}
          </div>
        ) : (
          <div className="note">No exports available for download.</div>
        )}
        <PreviewTabs markdown={markdown} json={jsonExport} />
      </section>

      <section className="card grid">
        <h2>Logs</h2>
        <div className="log-grid">
          <div>
            <h3>stdout</h3>
            {meta.logs?.stdoutTail ? <pre>{meta.logs.stdoutTail}</pre> : <div className="note">(empty)</div>}
          </div>
          <div>
            <h3>stderr</h3>
            {meta.logs?.stderrTail ? <pre>{meta.logs.stderrTail}</pre> : <div className="note">(empty)</div>}
          </div>
        </div>
      </section>
    </div>
  );
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    return null;
  }
}
