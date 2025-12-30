import UploadForm from "./_components/UploadForm";
import RecentDocs from "./_components/RecentDocs";
import { listDocs } from "./_lib/storage";

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
        <RecentDocs initialDocs={docs} />
      </section>
    </div>
  );
}
