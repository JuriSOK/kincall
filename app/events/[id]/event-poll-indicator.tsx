"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { EventStatus } from "@/lib/orchestration/states";
import { isWaitingStatus, startPolling } from "./event-poller";

// Thin React wiring around the pure poller in event-poller.ts. All actual
// polling behaviour (interval, overlap guard, stop-on-terminal-status,
// error handling) lives there and is unit tested directly; this component
// only supplies a fetch trigger (router.refresh(), which re-runs the server
// component and pulls fresh event/timeline data — no client-side data
// fetching or duplicated rendering logic needed) and the visibility toggle.
export function EventPollIndicator({
  eventId,
  status,
}: {
  eventId: string;
  status: EventStatus;
}) {
  const router = useRouter();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    function handleVisibilityChange() {
      setVisible(!document.hidden);
    }
    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    // Stops when the tab is hidden (via `visible` dropping out of this
    // effect's condition, tearing down any existing controller below) and
    // restarts automatically once it's visible again, if still waiting.
    if (!visible) return undefined;

    const controller = startPolling({
      eventId,
      status,
      onPollSuccess: () => {
        // A concerning Companion result, a no-answer, a decline — whatever
        // the fresh status is, this pulls it (and the timeline) via a normal
        // server re-render. If it's still a waiting status, the effect below
        // re-runs on the new `status` prop and polling continues on its own.
        router.refresh();
      },
      onError: () => {
        // Swallowed deliberately — see event-poller.ts's onError contract.
      },
    });

    // Unmount, eventId/status change, or visibility loss all tear this down.
    return () => controller.stop();
  }, [eventId, status, visible, router]);

  if (!isWaitingStatus(status)) return null;

  return (
    <span aria-live="polite" className="text-xs italic text-subtle">
      Updating…
    </span>
  );
}
