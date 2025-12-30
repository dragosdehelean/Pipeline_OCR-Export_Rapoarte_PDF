import type { DocStatus } from "../lib/schema";

export function StatusBadge({ status }: { status: DocStatus }) {
  const className = status === "SUCCESS" ? "success" : status === "FAILED" ? "failed" : "pending";
  return (
    <span className={`badge ${className}`}>
      {status}
    </span>
  );
}
