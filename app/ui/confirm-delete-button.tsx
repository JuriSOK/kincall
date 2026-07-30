"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./button";

export interface ConfirmDeleteButtonProps {
  /** The DELETE endpoint. Built by the caller so this component owns no routes. */
  endpoint: string;
  /** Shown in the confirmation dialog and used to build the accessible name. */
  subject: string;
  /** The full confirmation question. Spelled out by the caller, because what is
   *  being kept (history) differs between a profile and a contact. */
  confirmMessage: string;
  /** Visible text on the control. */
  label: string;
  /** Fallback message when the server sends no `error` field. */
  fallbackError: string;
  /**
   * "refresh": stay put and re-fetch the now-shorter list.
   * "redirect-home": used on a person's own page, where refreshing a page whose
   * subject was just archived makes no sense.
   */
  onSuccess: "refresh" | "redirect-home";
}

/**
 * The confirm-then-DELETE control shared by profile and trusted-contact
 * archiving (soft deletion — DEC-009; rows are never physically removed).
 *
 * Consolidated from two near-identical components. Two things are fixed here
 * rather than in both copies:
 *
 *  1. A thrown `fetch` (offline, DNS failure) used to leave `busy` true
 *     forever, permanently disabling the button with no way back but a reload.
 *     Every exit now releases it.
 *  2. The trigger had no visible text — only an emoji glyph with an
 *     `aria-label`. It now carries a real label beside the icon.
 *
 * Confirmation stays the browser's native `window.confirm()`: there is no modal
 * component in this codebase, and a native dialog is keyboard- and
 * screen-reader-operable with no dependency.
 */
export function ConfirmDeleteButton({
  endpoint,
  subject,
  confirmMessage,
  label,
  fallbackError,
  onSuccess,
}: ConfirmDeleteButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!window.confirm(confirmMessage)) return;

    setBusy(true);
    setError(null);

    // See PersonForm for the same pattern: on a redirect we keep the control
    // disabled through the route transition, but every other outcome — thrown
    // request included — must re-enable it.
    let navigating = false;
    try {
      const response = await fetch(endpoint, { method: "DELETE" });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        // Nothing was removed, so nothing is refreshed: the list stays exactly
        // as it was and the reason is shown inline. No optimistic removal, so a
        // refused deletion can never look like it succeeded.
        setError(body.error ?? fallbackError);
        return;
      }

      if (onSuccess === "redirect-home") {
        navigating = true;
        router.push("/");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      if (!navigating) setBusy(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        variant="danger"
        size="sm"
        onClick={handleClick}
        disabled={busy}
        aria-label={`${label} ${subject}`}
      >
        <span aria-hidden>🗑</span>
        {busy ? "Removing…" : label}
      </Button>
      {error ? (
        <span role="alert" className="text-xs font-medium text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
