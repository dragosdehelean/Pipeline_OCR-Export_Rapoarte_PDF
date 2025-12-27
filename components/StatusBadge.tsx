import React from "react";
import type { DocMeta } from "../lib/schema";

type Status = DocMeta["status"];

export function StatusBadge({ status }: { status: Status }) {
  const className = status === "SUCCESS" ? "success" : status === "FAILED" ? "failed" : "pending";
  return (
    <span className={`badge ${className}`}>
      {status}
    </span>
  );
}
