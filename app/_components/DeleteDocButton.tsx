/**
 * @fileoverview Delete control for documents with confirmation and UI feedback.
 */
"use client";

import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DocMeta } from "../_lib/schema";

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
  const [isConfirming, setIsConfirming] = useState(false);
  const dialogId = useId();

  const mutation = useMutation({
    mutationFn: () => deleteDoc(docId),
    onSuccess: () => {
      setError("");
      setIsConfirming(false);
      queryClient.setQueryData<DocMeta[]>(["docs"], (current) => {
        if (!Array.isArray(current)) {
          return current;
        }
        return current.filter((doc) => doc.id !== docId);
      });
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

  const handleConfirm = () => {
    if (mutation.isPending) {
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
        onClick={() => {
          if (!mutation.isPending) {
            setError("");
            setIsConfirming(true);
          }
        }}
        disabled={mutation.isPending}
        aria-label={ariaLabel ?? label}
      >
        {mutation.isPending ? "Deleting..." : label}
      </button>
      {isConfirming ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogId}
          >
            <h3 id={dialogId}>Confirm deletion</h3>
            <p className="note">{confirmMessage}</p>
            <div className="modal-actions">
              <button
                type="button"
                className="button ghost"
                onClick={() => setIsConfirming(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button danger"
                onClick={handleConfirm}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? "Deleting..." : "Yes, delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="note delete-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
