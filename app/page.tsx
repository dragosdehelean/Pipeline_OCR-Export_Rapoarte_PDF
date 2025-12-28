import UploadForm from "../components/UploadForm";
import RecentDocs from "../components/RecentDocs";
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
          <RecentDocs docs={docs} />
        )}
      </section>
    </div>
  );
}
