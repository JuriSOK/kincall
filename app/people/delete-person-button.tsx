"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  personId: string;
  personName: string;
  // "refresh": stay on the current page and re-fetch the (now shorter) list —
  // used on the home page. "redirect-home": used on the person's own detail
  // page, where refreshing the same page after deleting yourself makes no
  // sense; go to "/" instead.
  mode: "refresh" | "redirect-home";
}

// Soft deletion (optional interface administration, not core orchestration —
// see docs/DECISION_LOG.md DEC-009). The confirmation dialog is the browser's
// native confirm(): there is no modal component in this codebase, and a
// native dialog needs no dependency and is unambiguous.
export function DeletePersonButton({ personId, personName, mode }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    const confirmed = window.confirm(
      `Delete ${personName}? This removes them from view but keeps their history.`
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/people/${personId}`, { method: "DELETE" });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      // Nothing removed: the error is shown and the list/page is untouched.
      setError(body.error ?? "Could not delete this profile.");
      setBusy(false);
      return;
    }

    if (mode === "redirect-home") {
      router.push("/");
      return;
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-label={`Delete ${personName}`}
        title={`Delete ${personName}`}
        className="rounded p-1 text-sm leading-none opacity-50 hover:text-red-600 hover:opacity-100 disabled:opacity-30 dark:hover:text-red-400"
      >
        🗑
      </button>
      {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : null}
    </span>
  );
}
