/**
 * @fileoverview Small status badge component for document state.
 */
import type { DocStatus } from "../_lib/schema";

/**
 * Renders a badge with styling based on document status.
 */
export function StatusBadge({ status }: { status: DocStatus }) {
  const className = status === "SUCCESS" ? "success" : status === "FAILED" ? "failed" : "pending";
  return (
    <span className={`badge ${className}`}>
      {status}
    </span>
  );
}
