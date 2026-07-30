"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/app/ui/button";
import { Card, PageHeader, PageShell } from "@/app/ui/surfaces";

/**
 * The route-level error boundary. Without it, an unhandled error in any page or
 * layout below falls through to Next.js's own default screen, which is a stack
 * trace in development and an unbranded "something went wrong" in production.
 *
 * Deliberately says nothing about the vulnerable person or the check-in: this
 * boundary can be reached from any route, so it has no idea whether an event
 * is in flight and must not imply either that one is or that one is not. It
 * also never renders `error.message`, which can carry internal detail.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side detail is already in the platform logs; this is what a
    // browser-side failure leaves behind. `digest` is the id to correlate with.
    console.error("KinCall route error", error.digest ?? error.message);
  }, [error]);

  return (
    <PageShell width="narrow">
      <PageHeader
        title="Something went wrong on this page"
        lead="The page could not be displayed. Nothing you were looking at has been changed or deleted."
      />

      <Card>
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-muted">
            Check-ins already recorded are safe — this is a problem displaying them, not a problem
            with the record itself. Trying again is safe.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={reset}>Try again</Button>
            <ButtonLink href="/">Back to profiles</ButtonLink>
          </div>
          {error.digest ? (
            <p className="text-xs text-subtle">
              Reference for the logs: <span className="font-mono">{error.digest}</span>
            </p>
          ) : null}
        </div>
      </Card>
    </PageShell>
  );
}
