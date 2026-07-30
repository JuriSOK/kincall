import Link from "next/link";
import type { Tone } from "./tone";
import { Badge } from "./surfaces";

export interface ProfileCardProps {
  personId: string;
  personName: string;
  statusLabel: string;
  statusTone: Tone;
  // One plain sentence — the same text a person page/event page would show,
  // never a raw enum.
  latestResultSummary: string;
  preferredCallTime: string;
  circleCount: number;
  // How many of that circle have not confirmed consent — 0 renders nothing.
  circleConsentGapCount: number;
}

// Deliberately five facts, not fifteen (progressive disclosure — §7 of the
// Stage B brief): name, one status badge, the latest result in one sentence,
// the preferred check-in time (never "next check-in" — no schedule has been
// computed anywhere yet, see lib/presentation's Stage D note), and a one-line
// circle summary. Everything else lives one click away via the three links.
export function ProfileCard({
  personId,
  personName,
  statusLabel,
  statusTone,
  latestResultSummary,
  preferredCallTime,
  circleCount,
  circleConsentGapCount,
}: ProfileCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-kc border border-line bg-surface p-4 shadow-kc-sm transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between gap-3">
        <Link href={`/people/${personId}`} className="text-sm font-semibold hover:text-accent">
          {personName}
        </Link>
        <Badge tone={statusTone}>{statusLabel}</Badge>
      </div>

      <p className="text-sm text-muted">{latestResultSummary}</p>

      <p className="text-xs text-subtle">Preferred check-in time: daily at {preferredCallTime}</p>

      <p className="text-xs text-subtle">
        {circleCount === 0
          ? "No trusted contacts"
          : `${circleCount} trusted contact${circleCount === 1 ? "" : "s"}`}
        {circleConsentGapCount > 0 ? ` · ${circleConsentGapCount} need${circleConsentGapCount === 1 ? "s" : ""} consent` : ""}
      </p>

      <div className="mt-1 flex flex-wrap gap-3 text-xs">
        <Link href={`/people/${personId}`} className="text-accent hover:underline">
          Profile
        </Link>
        <Link href={`/history?person=${personId}`} className="text-accent hover:underline">
          History
        </Link>
        <Link href={`/people/${personId}/contacts`} className="text-accent hover:underline">
          Circle
        </Link>
      </div>
    </div>
  );
}
