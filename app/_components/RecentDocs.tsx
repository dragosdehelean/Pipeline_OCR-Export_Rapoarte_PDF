"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "./StatusBadge";
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

      {filteredDocs.length === 0 ? (
        <div className="note">No documents match your filters yet.</div>
      ) : (
        <div className="list">
          {filteredDocs.map((doc) => {
            const failureSummary = summarizeFailure(doc);
            return (
              <div className="list-item" key={doc.id} data-status={doc.status}>
                <div className="list-item-top">
                  <StatusBadge status={doc.status} />
                  <Link className="doc-link" href={`/docs/${doc.id}`}>
                    {doc.originalFileName}
                  </Link>
                  <Link className="ghost-link" href={`/docs/${doc.id}`}>
                    View details
                  </Link>
                </div>
                {failureSummary ? (
                  <div className="note">Reason: {failureSummary}</div>
                ) : null}
                <div className="meta-row">
                  <span>Created: {formatDateTime(doc.createdAt)}</span>
                  <span>Pages: {formatNumber(doc.metrics.pages)}</span>
                  <span>Text chars: {formatNumber(doc.metrics.textChars)}</span>
                  <span>Markdown chars: {formatNumber(doc.metrics.mdChars)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
