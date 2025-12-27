import Link from "next/link";
import UploadForm from "../components/UploadForm";
import { StatusBadge } from "../components/StatusBadge";
import { listDocs } from "../lib/storage";

export const runtime = "nodejs";

export default async function HomePage() {
  const docs = await listDocs(50);

  return (
    <div className="container">
      <header className="header">
        <h1>Doc Ingestion & Export</h1>
        <p>Local Docling-only processing with strict quality gates.</p>
      </header>

      <section className="card">
        <UploadForm />
      </section>

      <section className="card grid">
        <h2>Recent documents</h2>
        {docs.length === 0 ? (
          <div className="note">No documents processed yet.</div>
        ) : (
          <div className="list">
            {docs.map((doc) => (
              <div className="list-item" key={doc.id}>
                <div>
                  <StatusBadge status={doc.status} />
                </div>
                <div>
                  <Link href={`/docs/${doc.id}`}>{doc.originalFileName}</Link>
                </div>
                <div className="meta-row">
                  <span>Created: {new Date(doc.createdAt).toLocaleString()}</span>
                  <span>Pages: {doc.metrics.pages}</span>
                  <span>Text chars: {doc.metrics.textChars}</span>
                  <span>MD chars: {doc.metrics.mdChars}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
