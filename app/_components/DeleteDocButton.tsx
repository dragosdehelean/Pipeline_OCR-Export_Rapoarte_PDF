/**
 * @fileoverview Delete control for documents with confirmation and UI feedback.
 */
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

type DeleteDocResponse = {
  id: string;
  deleted: boolean;
  removedIndex: boolean;
  removedUpload: boolean;
  removedExport: boolean;
};

type DeleteDocButtonProps = {
  docId: string;
  label?: string;
  className?: string;
  confirmMessage?: string;
  redirectTo?: string;
  ariaLabel?: string;
  onDeleted?: () => void;
};

async function deleteDoc(docId: string): Promise<DeleteDocResponse> {
  const response = await fetch(`/api/docs/${docId}`, { method: "DELETE" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      payload && typeof payload.error === "string"
        ? payload.error
        : "Failed to delete document.";
    throw new Error(message);
  }
  return (await response.json()) as DeleteDocResponse;
}

/**
 * Renders a delete button that removes a document and its artifacts.
 */
export default function DeleteDocButton({
  docId,
  label = "Delete",
  className = "button ghost",
  confirmMessage = "Delete this document and all stored files?",
  redirectTo,
  ariaLabel,
  onDeleted
}: DeleteDocButtonProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => deleteDoc(docId),
    onSuccess: () => {
      setError("");
      queryClient.invalidateQueries({ queryKey: ["docs"] });
      if (redirectTo) {
        window.location.assign(redirectTo);
      }
      onDeleted?.();
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Failed to delete document.";
      setError(message);
    }
  });

  const handleClick = () => {
    if (mutation.isPending) {
      return;
    }
    if (!window.confirm(confirmMessage)) {
      return;
    }
    setError("");
    mutation.mutate();
  };

  return (
    <div className="delete-control">
      <button
        type="button"
        className={className}
        onClick={handleClick}
        disabled={mutation.isPending}
        aria-label={ariaLabel ?? label}
      >
        {mutation.isPending ? "Deleting..." : label}
      </button>
      {error ? (
        <div className="note delete-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
