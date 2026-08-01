import Link from "next/link";
import { formatTime } from "@/lib/presentation/format-date";
import type { HistoryEventView } from "@/lib/presentation/history-view";
import { Badge } from "./surfaces";
import { Avatar } from "./avatars/avatar";

// One event, as a row — shared by the dashboard's "Recent activity" section
// and the history page's day-grouped list, so the same event is described
// identically wherever it appears (both read from the same
// lib/presentation/history-view.ts builder).
export function ActivityRow({ view }: { view: HistoryEventView }) {
  return (
    <Link
      href={view.href}
      className="flex flex-wrap items-center gap-3 rounded-kc border border-line bg-sunken px-4 py-3 transition-colors hover:border-line-strong"
    >
      <span className="font-mono text-xs text-subtle">{formatTime(view.createdAt)}</span>
      <Avatar avatarKey={view.avatarKey} name={view.personName} size="sm" />
      <span className="text-sm font-medium">{view.personName}</span>
      <Badge tone={view.statusTone}>{view.statusLabel}</Badge>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-muted">{view.summary}</span>
        {/* Stage F (DEC-019): the confirmed-intervention line, when one
            genuinely exists. Its own line rather than replacing the summary
            above — "what happened" and "who is handling it" are different
            questions, and a family member scanning this list needs both. */}
        {view.interventionSummary ? (
          <span className="truncate text-sm font-medium text-calm-ink">
            {view.interventionSummary}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
