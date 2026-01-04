"use client";

/**
 * @fileoverview Client-side list and filtering for recent documents.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "./StatusBadge";
import DeleteDocButton from "./DeleteDocButton";
import { docMetaSchema, type DocMeta, type DocStatus } from "../_lib/schema";

type StatusFilter = "all" | DocStatus;

const statusOptions: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "all" },
  { label: "Success", value: "SUCCESS" },
  { label: "Failed", value: "FAILED" },
  { label: "Pending", value: "PENDING" }
];

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatDateTime(value: string) {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "n/a";
  }
  return date.toLocaleString();
}

function summarizeFailure(doc: DocMeta) {
  if (!doc.failedGates.length) {
    return null;
  }
  const [first, ...rest] = doc.failedGates;
  if (rest.length === 0) {
    return first.message;
  }
  return `${first.message} (+${rest.length} more)`;
}

async function fetchDocs(signal?: AbortSignal): Promise<DocMeta[]> {
  const response = await fetch("/api/docs", { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error("Failed to load documents.");
  }
  const payload = (await response.json()) as { docs?: unknown };
  const parsed = docMetaSchema.array().safeParse(payload.docs);
  return parsed.success ? parsed.data : [];
}

/**
 * Renders the recent documents list with filters and stats.
 */
export default function RecentDocs({ initialDocs = [] }: { initialDocs?: DocMeta[] }) {
  const docsQuery = useQuery({
    queryKey: ["docs"],
    queryFn: ({ signal }) => fetchDocs(signal),
    initialData: initialDocs,
    staleTime: 10_000,
    refetchInterval: (query) => {
      const docs = query.state.data ?? [];
      return docs.some((doc) => doc.status === "PENDING") ? 2000 : false;
    }
  });
  const docs = docsQuery.data ?? initialDocs;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  const totals = useMemo(() => {
    const total = docs.length;
    const success = docs.filter((doc) => doc.status === "SUCCESS").length;
    const failed = docs.filter((doc) => doc.status === "FAILED").length;
    const pending = docs.filter((doc) => doc.status === "PENDING").length;
    return { total, success, failed, pending };
  }, [docs]);

  const filteredDocs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return docs.filter((doc) => {
      if (statusFilter !== "all" && doc.status !== statusFilter) {
        return false;
      }
      if (normalized.length > 0) {
        return doc.originalFileName.toLowerCase().includes(normalized);
      }
      return true;
    });
  }, [docs, query, statusFilter]);

  const hasFilters = statusFilter !== "all" || query.trim().length > 0;

  if (docs.length === 0) {
    if (docsQuery.isPending) {
      return <div className="note">Loading documents...</div>;
    }
    if (docsQuery.isError) {
      return <div className="note">Unable to load documents.</div>;
    }
    return <div className="note">No documents processed yet.</div>;
  }

  return (
    <div className="grid">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total</div>
          <div className="stat-value">{formatNumber(totals.total)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Success</div>
          <div className="stat-value">{formatNumber(totals.success)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Failed</div>
          <div className="stat-value">{formatNumber(totals.failed)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pending</div>
          <div className="stat-value">{formatNumber(totals.pending)}</div>
        </div>
      </div>

      <div className="filter-bar">
        <div className="search-field">
          <label htmlFor="doc-search">Search documents</label>
          <input
            id="doc-search"
            type="search"
            placeholder="Search by filename"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="filter-pills" role="tablist" aria-label="Filter by status">
          {statusOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`pill ${statusFilter === option.value ? "active" : ""}`}
              onClick={() => setStatusFilter(option.value)}
              role="tab"
              aria-selected={statusFilter === option.value}
            >
              {option.label}
            </button>
          ))}
          {hasFilters ? (
            <button
              type="button"
              className="pill subtle"
              onClick={() => {
                setQuery("");
                setStatusFilter("all");
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
        <div className="note">
          Showing {filteredDocs.length} of {docs.length}
        </div>
      </div>

      {deleteNotice ? (
        <div className="alert success" role="status">
          <div className="alert-title">{deleteNotice}</div>
        </div>
      ) : null}

      {filteredDocs.length === 0 ? (
        <div className="note">No documents match your filters yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Document</th>
                <th>Actions</th>
                <th>Created</th>
                <th>Pages</th>
                <th>Text chars</th>
                <th>Markdown chars</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocs.map((doc) => {
                const failureSummary = summarizeFailure(doc);
                return (
                  <tr key={doc.id} data-status={doc.status} data-doc-id={doc.id}>
                    <td>
                      <StatusBadge status={doc.status} />
                    </td>
                    <td>
                      <Link className="doc-link" href={`/docs/${doc.id}`}>
                        {doc.originalFileName}
                      </Link>
                      {failureSummary ? (
                        <div className="note">Reason: {failureSummary}</div>
                      ) : null}
                    </td>
                    <td>
                      <div className="table-actions">
                        <Link className="ghost-link" href={`/docs/${doc.id}`}>
                          View details
                        </Link>
                        <DeleteDocButton
                          docId={doc.id}
                          label="Delete"
                          className="ghost-link danger"
                          onDeleted={() =>
                            setDeleteNotice("Document deleted successfully")
                          }
                        />
                      </div>
                    </td>
                    <td>{formatDateTime(doc.createdAt)}</td>
                    <td>{formatNumber(doc.metrics.pages)}</td>
                    <td>{formatNumber(doc.metrics.textChars)}</td>
                    <td>{formatNumber(doc.metrics.mdChars)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
