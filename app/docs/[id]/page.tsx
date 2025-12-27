import fs from "fs/promises";
import { notFound } from "next/navigation";
import PreviewTabs from "../../../components/PreviewTabs";
import { StatusBadge } from "../../../components/StatusBadge";
import { resolveStatus } from "../../../lib/meta";
import { getJsonPath, getMarkdownPath, readMetaFile } from "../../../lib/storage";

export const runtime = "nodejs";

export default async function DocDetailsPage({
  params
}: {
  params: { id: string };
}) {
  let meta: Record<string, any>;
  try {
    meta = await readMetaFile(params.id);
  } catch (error) {
    notFound();
  }

  const markdown = await readOptionalFile(getMarkdownPath(params.id));
  const jsonExport = await readOptionalFile(getJsonPath(params.id));

  const failedGates = meta.qualityGates?.failedGates ?? [];
  const status = resolveStatus(meta as Record<string, unknown>, failedGates);

  return (
    <div className="container">
      <header className="header">
        <h1>{meta.source?.originalFileName ?? params.id}</h1>
        <p>Document details and exports.</p>
      </header>

      <section className="card grid">
        <div>
          <StatusBadge status={status} />
        </div>
        <div className="meta-row">
          <span>ID: {meta.id}</span>
          <span>Created: {new Date(meta.createdAt).toLocaleString()}</span>
          <span>Mime: {meta.source?.mimeType}</span>
          <span>Pages: {meta.metrics?.pages ?? 0}</span>
          <span>Text chars: {meta.metrics?.textChars ?? 0}</span>
          <span>MD chars: {meta.metrics?.mdChars ?? 0}</span>
        </div>
        <div className="meta-row">
          <span>Exit code: {meta.processing?.exitCode ?? "n/a"}</span>
          <span>Duration: {meta.processing?.durationMs ?? 0} ms</span>
        </div>
      </section>

      <section className="card grid">
        <h2>Quality gates</h2>
        {failedGates.length === 0 ? (
          <div className="note">No failed gates reported.</div>
        ) : (
          <div className="list">
            {failedGates.map((gate: any) => (
              <div className="list-item" key={gate.code}>
                <strong>{gate.code}</strong>
                <div className="note">{gate.message}</div>
                <div className="meta-row">
                  <span>Actual: {gate.actual}</span>
                  <span>Expected: {gate.expectedOp} {gate.expected}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {status === "FAILED" && failedGates.length === 0 ? (
          <div className="note">Processing failed. Check logs below.</div>
        ) : null}
      </section>

      <section className="card grid">
        <h2>Exports</h2>
        <PreviewTabs markdown={markdown} json={jsonExport} />
      </section>

      <section className="card grid">
        <h2>Logs</h2>
        <div>
          <h3>stdout</h3>
          {meta.logs?.stdoutTail ? <pre>{meta.logs.stdoutTail}</pre> : <div className="note">(empty)</div>}
        </div>
        <div>
          <h3>stderr</h3>
          {meta.logs?.stderrTail ? <pre>{meta.logs.stderrTail}</pre> : <div className="note">(empty)</div>}
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
