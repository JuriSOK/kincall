"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/app/ui/button";
import { controlClasses } from "@/app/ui/form-field";
import { Badge, Notice } from "@/app/ui/surfaces";

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

      // Guarded rather than destructured straight through: a 200 whose body is
      // not the JSON we expect must not navigate to /events/undefined.
      const body = (await response.json().catch(() => null)) as { eventId?: string } | null;
      if (!body?.eventId) {
        throw new Error("The check-in started but its id could not be read. Reload to find it.");
      }

      router.push(`/events/${body.eventId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to launch demo.");
      setIsLaunching(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {scenarios && scenarios.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-kc border border-line bg-sunken p-4">
          {/* Labelled unmistakably as demo data, so nobody can mistake a canned
              scenario for something that actually happened. */}
          <Badge tone="attention">Demo data — fake mode only, no calls are placed</Badge>
          <label htmlFor="demo-scenario" className="mt-1 text-sm font-medium">
            Scenario
          </label>
          <select
            id="demo-scenario"
            value={scenario}
            onChange={(changeEvent) => setScenario(changeEvent.target.value)}
            disabled={isLaunching}
            aria-describedby={selected ? "demo-scenario-description" : undefined}
            className={controlClasses}
          >
            {scenarios.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {selected ? (
            <p id="demo-scenario-description" className="text-xs text-muted">
              {selected.description}
            </p>
          ) : null}
        </div>
      ) : null}

      <Button
        onClick={handleClick}
        disabled={isLaunching || Boolean(blockedReason)}
        className="w-fit"
      >
        {isLaunching ? "Launching demo…" : "Launch demo"}
      </Button>
      {blockedReason ? <Notice tone="attention">{blockedReason}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </div>
  );
}
