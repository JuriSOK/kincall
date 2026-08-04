import Link from "next/link";
import type { Tone } from "@/shared/presentation/tone";
import { Badge } from "@/frontend/design-system/surfaces";
import { Avatar } from "./avatars/avatar";

export interface ProfileCardProps {
  personId: string;
  personName: string;
  avatarKey: string | null;
  statusLabel: string;
  statusTone: Tone;
  // One plain sentence — the same text a person page/event page would show,
  // never a raw enum.
  latestResultSummary: string;
  // A single, ready-to-render schedule line — e.g. "Next planned check-in:
  // Tomorrow at 09:00 (Europe/Paris)", "Schedule paused", "Schedule
  // inactive", or "No check-in days selected" — built by the caller via
  // src/shared/presentation/format-schedule.ts's formatNextCheckIn (Stage D), so this
  // component stays presentation-only and never computes a schedule itself.
  scheduleSummary: string;
  circleCount: number;
  // How many of that circle have not confirmed consent — 0 renders nothing.
  circleConsentGapCount: number;
}

// Deliberately five facts, not fifteen (progressive disclosure — §7 of the
// Stage B brief): name, one status badge, the latest result in one sentence,
// the schedule summary (Stage D — never claims a computed occurrence is
// guaranteed to run), and a one-line circle summary. Everything else lives
// one click away via the three links.
export function ProfileCard({
  personId,
  personName,
  avatarKey,
  statusLabel,
  statusTone,
  latestResultSummary,
  scheduleSummary,
  circleCount,
  circleConsentGapCount,
}: ProfileCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-kc border border-line bg-surface p-4 shadow-kc-sm transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between gap-3">
        <Link href={`/people/${personId}`} className="flex items-center gap-2 text-sm font-semibold hover:text-accent">
          <Avatar avatarKey={avatarKey} name={personName} size="sm" />
          {personName}
        </Link>
        <Badge tone={statusTone}>{statusLabel}</Badge>
      </div>

      <p className="text-sm text-muted">{latestResultSummary}</p>

      <p className="text-xs text-subtle">{scheduleSummary}</p>

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
