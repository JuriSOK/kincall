"use client";

import { ConfirmDeleteButton } from "@/app/ui/confirm-delete-button";

interface Props {
  personId: string;
  personName: string;
  // "refresh": stay on the current page and re-fetch the (now shorter) list —
  // used on the dashboard's profile list. "redirect-dashboard": used on the
  // person's own detail page, where refreshing the same page after deleting
  // yourself makes no sense; go to /dashboard instead.
  mode: "refresh" | "redirect-dashboard";
}

// Soft deletion (optional interface administration, not core orchestration —
// see docs/DECISION_LOG.md DEC-009). The behaviour lives in
// app/ui/confirm-delete-button.tsx, shared with trusted-contact archiving;
// this wrapper only supplies the wording and the endpoint.
export function DeletePersonButton({ personId, personName, mode }: Props) {
  return (
    <ConfirmDeleteButton
      endpoint={`/api/people/${personId}`}
      subject={personName}
      label="Remove"
      confirmMessage={`Remove ${personName}? They disappear from the list, and their check-in history is kept.`}
      fallbackError="Could not remove this profile."
      onSuccess={mode}
    />
  );
}
