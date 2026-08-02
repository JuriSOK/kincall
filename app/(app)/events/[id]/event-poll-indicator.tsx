"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { EventStatus } from "@/lib/orchestration/states";
import { isWaitingStatus, startPolling, type PollController } from "./event-poller";

// How many consecutive failures before the user is told. One transient blip
// while a call is in flight is normal and self-heals on the next tick; a
// sustained failure means the page has genuinely stopped tracking the event
// and silently showing "Updating…" forever would be a lie.
const FAILURES_BEFORE_WARNING = 3;

// Thin React wiring around the pure poller in event-poller.ts. All actual
// polling behaviour (immediate first poll, interval, overlap guard,
// stop-on-terminal-status, bounded backoff) lives there and is unit tested
// directly; this component only supplies the refresh trigger, the visibility
// handling, and the inline failure state.
export function EventPollIndicator({
  eventId,
  status,
}: {
  eventId: string;
  status: EventStatus;
}) {
  const router = useRouter();
  const [failing, setFailing] = useState(false);
  // The controller for the CURRENT poller, so the visibility listener can ask
  // it to poll immediately without being part of the polling effect's deps
  // (which would tear the poller down and rebuild it on every visibility flip).
  const controllerRef = useRef<PollController | null>(null);
  // The last status this component actually told the server-render about.
  // Used to refresh only on a real change — see onPollSuccess below.
  const lastSeenStatus = useRef<EventStatus>(status);

  useEffect(() => {
    lastSeenStatus.current = status;
  }, [status]);

  useEffect(() => {
    if (!isWaitingStatus(status)) return undefined;

    setFailing(false);
    const controller = startPolling({
      eventId,
      status,
      onPollSuccess: (freshStatus) => {
        setFailing(false);
        // Refresh only when the status genuinely moved. A poll that reports
        // the same status changed nothing the page renders, and refreshing
        // anyway cost a full server re-render (5 database reads) every tick —
        // at the new 2s cadence that would be 30 wasted re-renders a minute.
        //
        // Safe because the poll route is the only thing that can advance this
        // event while the page is open, and any advance it makes IS a status
        // change: timeline entries are written by the same transitions that
        // move the status, never independently of them.
        if (freshStatus !== lastSeenStatus.current) {
          lastSeenStatus.current = freshStatus;
          router.refresh();
        }
      },
      onError: (_error, consecutiveFailures) => {
        // Never treated as a status: only a successful poll, running the real
        // server-side orchestration, can change what this event is.
        setFailing(consecutiveFailures >= FAILURES_BEFORE_WARNING);
      },
    });

    controllerRef.current = controller;

    // Unmount or an eventId/status change tears this down. Visibility is
    // deliberately NOT a dependency: a hidden tab keeps its poller (the
    // backoff already bounds the cost) and simply polls immediately on return,
    // rather than losing and rebuilding it on every tab switch.
    return () => {
      controller.stop();
      controllerRef.current = null;
    };
  }, [eventId, status, router]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (!document.hidden) controllerRef.current?.pollNow();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  if (!isWaitingStatus(status)) return null;

  if (failing) {
    return (
      <span aria-live="polite" className="text-xs italic text-attention-ink">
        Not updating — check your connection. The check-in itself continues.
      </span>
    );
  }

  return (
    <span aria-live="polite" className="text-xs italic text-subtle">
      Updating…
    </span>
  );
}
