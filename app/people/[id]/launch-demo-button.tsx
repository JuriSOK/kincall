"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface DemoScenarioOption {
  id: string;
  label: string;
  description: string;
}

export function LaunchDemoButton({
  personId,
  blockedReason,
  scenarios,
}: {
  personId: string;
  // Set when consent is not confirmed (§17.1 / DEC-007). The engine refuses
  // regardless; disabling here explains why instead of failing after a click.
  blockedReason?: string;
  // Fake-mode demo scenarios (DEC-011). Undefined in live mode, where no
  // selector is rendered at all and no scenario is ever sent — the server
  // ignores the parameter in live mode too, so this is defence in depth.
  scenarios?: DemoScenarioOption[];
}) {
  const router = useRouter();
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState(scenarios?.[0]?.id ?? "");

  const selected = scenarios?.find((option) => option.id === scenario);

  async function handleClick() {
    setIsLaunching(true);
    setError(null);
    try {
      const response = await fetch("/api/events/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only ever sent when a selector exists, i.e. in fake mode.
        body: JSON.stringify(scenarios ? { personId, scenario } : { personId }),
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
      {scenarios && scenarios.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md border border-black/10 p-4 dark:border-white/10">
          {/* Labelled unmistakably as demo data, so nobody can mistake a canned
              scenario for something that actually happened. */}
          <p className="text-xs font-medium uppercase tracking-wide opacity-60">
            Demo data — fake mode only, no calls are placed
          </p>
          <label htmlFor="demo-scenario" className="mt-1 text-sm font-medium">
            Scenario
          </label>
          <select
            id="demo-scenario"
            value={scenario}
            onChange={(changeEvent) => setScenario(changeEvent.target.value)}
            disabled={isLaunching}
            className="w-full rounded-md border border-black/20 bg-transparent px-3 py-2 text-sm dark:border-white/20"
          >
            {scenarios.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {selected ? <p className="text-xs opacity-70">{selected.description}</p> : null}
        </div>
      ) : null}

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
