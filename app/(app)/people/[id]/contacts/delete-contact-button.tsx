"use client";

import { ConfirmDeleteButton } from "@/app/ui/confirm-delete-button";

interface Props {
  personId: string;
  contactId: string;
  contactName: string;
}

// Soft deletion (DEC-009). Always refreshes on success — this component is
// only ever used inside the contacts management page, so there is no
// "currently viewing this exact contact" redirect case to handle.
export function DeleteContactButton({ personId, contactId, contactName }: Props) {
  return (
    <ConfirmDeleteButton
      endpoint={`/api/people/${personId}/contacts/${contactId}`}
      subject={contactName}
      label="Remove"
      confirmMessage={`Remove ${contactName} from the trusted circle? They will not be called again, and past calls to them are kept.`}
      fallbackError="Could not remove this contact."
      onSuccess="refresh"
    />
  );
}
