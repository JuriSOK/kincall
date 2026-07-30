"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ScheduleState } from "@/lib/database/types";
import { Button } from "@/app/ui/button";
import { Notice } from "@/app/ui/surfaces";
import { submitScheduleToggle } from "./schedule-toggle-submit";

// A lightweight Pause/Resume toggle, separate from the full profile-edit
// form: it changes exactly `scheduleState`, nothing else, so using it can
// never accidentally overwrite some other field a user is mid-editing
// elsewhere. "inactive" is treated the same as "paused" here — both mean
// "not currently scheduled" — and both resume to "active"; setting
// "inactive" itself remains a full-edit-form-only choice, since it is not
// part of the everyday pause/resume gesture this control exists for.
export function ScheduleToggleButton({
  personId,
  personName,
  scheduleState,
}: {
  personId: string;
  personName: string;
  scheduleState: ScheduleState;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextState: ScheduleState = scheduleState === "active" ? "paused" : "active";
  const label = scheduleState === "active" ? "Pause schedule" : "Resume schedule";

  async function handleClick() {
    setSubmitting(true);
    setError(null);

    try {
      // No optimistic flip: the button's own label and the schedule state
      // shown elsewhere on this page do not change until the server has
      // actually confirmed the write — router.refresh() below re-fetches
      // the authoritative value once it has.
      const result = await submitScheduleToggle(nextState, { personId });

      if (!result.ok) {
        setError(
          result.networkError ??
            Object.values(result.errors)[0] ??
            "Could not update the schedule. Please try again."
        );
        return;
      }

      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={handleClick}
        disabled={submitting}
        aria-label={`${label} for ${personName}`}
      >
        {submitting ? "Saving…" : label}
      </Button>
      {error ? (
        <Notice tone="danger" assertive>
          {error}
        </Notice>
      ) : null}
    </span>
  );
}
