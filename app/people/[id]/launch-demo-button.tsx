"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LaunchDemoButton({
  personId,
  blockedReason,
}: {
  personId: string;
  // Set when consent is not confirmed (§17.1 / DEC-007). The engine refuses
  // regardless; disabling here explains why instead of failing after a click.
  blockedReason?: string;
}) {
  const router = useRouter();
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setIsLaunching(true);
    setError(null);
    try {
      const response = await fetch("/api/events/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Failed to start demo event (${response.status}).`);
      }

      const { eventId } = (await response.json()) as { eventId: string };
      router.push(`/events/${eventId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to launch demo.");
      setIsLaunching(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isLaunching || Boolean(blockedReason)}
        title={blockedReason}
        className="w-fit rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
      >
        {isLaunching ? "Launching demo…" : "Launch demo"}
      </button>
      {blockedReason ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">{blockedReason}</p>
      ) : null}
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
    </div>
  );
}
