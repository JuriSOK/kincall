"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  personId: string;
  contactId: string;
  contactName: string;
}

// Soft deletion (DEC-009). Always refreshes on success — this component is
// only ever used inside the contacts management page, so there is no
// "currently viewing this exact contact" redirect case to handle.
export function DeleteContactButton({ personId, contactId, contactName }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    const confirmed = window.confirm(`Remove ${contactName} from the trusted circle?`);
    if (!confirmed) return;

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/people/${personId}/contacts/${contactId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      // Nothing removed: the error is shown and the list is untouched.
      setError(body.error ?? "Could not remove this contact.");
      setBusy(false);
      return;
    }

    setBusy(false);
    router.refresh();
  }

  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-label={`Delete ${contactName}`}
        title={`Delete ${contactName}`}
        className="rounded border border-black/20 px-2 py-1 text-xs opacity-60 hover:text-red-600 hover:opacity-100 disabled:opacity-30 dark:border-white/20 dark:hover:text-red-400"
      >
        🗑
      </button>
      {error ? (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      ) : null}
    </span>
  );
}
