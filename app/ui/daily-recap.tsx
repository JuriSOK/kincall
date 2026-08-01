import Link from "next/link";
import type { Tone } from "./tone";
import { Badge } from "./surfaces";
import { Avatar } from "./avatars/avatar";

export interface DailyRecapItem {
  personId: string;
  personName: string;
  avatarKey: string | null;
  statusLabel: string;
  statusTone: Tone;
  // One plain sentence — the same text a profile card would show, never a
  // raw enum. "No check-in has run yet." when there is no event at all.
  summary: string;
  // A short, pre-formatted "when" label ("Today, 09:12" or a past date), or
  // null when there is no event to date at all.
  timeLabel: string | null;
  // The event's own decisionReason, shown only in the expanded detail — never
  // in the collapsed row, which stays to one line.
  decisionReason: string | null;
  // Null when this person has never had a check-in — there is then nothing
  // to view beyond the profile itself.
  eventHref: string | null;
  profileHref: string;
}

// One person, one row: a native <details>/<summary> disclosure — the same
// zero-JavaScript, keyboard-operable pattern app/ui/nav.tsx already uses for
// its mobile menu. Collapsed, it reads as a daily recap (name, status,
// one-line summary); expanded, it reveals the decision reason and a link to
// the full event, so the change from an alert-only "Needs attention" block
// to a recap never removes access to detail — it is one click away instead
// of the only thing on the page.
export function DailyRecapRow({ item }: { item: DailyRecapItem }) {
  return (
    <details className="group rounded-kc border border-line bg-sunken open:bg-surface open:shadow-kc-sm">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 marker:content-none">
        <Avatar avatarKey={item.avatarKey} name={item.personName} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{item.personName}</span>
            {item.timeLabel ? (
              <span className="text-xs text-subtle">{item.timeLabel}</span>
            ) : null}
          </span>
          <span className="block truncate text-xs text-muted">{item.summary}</span>
        </span>
        <Badge tone={item.statusTone}>{item.statusLabel}</Badge>
        {/* Decorative only — the expanded/collapsed state is already
            announced natively by <details>'s own semantics. */}
        <span
          aria-hidden="true"
          className="shrink-0 text-subtle transition-transform group-open:rotate-180"
        >
          ⌄
        </span>
      </summary>

      <div className="flex flex-col gap-2 border-t border-line px-4 py-3 text-sm">
        {item.decisionReason ? <p className="text-muted">{item.decisionReason}</p> : null}
        <div className="flex flex-wrap gap-3 text-xs">
          {item.eventHref ? (
            <Link href={item.eventHref} className="text-accent hover:underline">
              View full event
            </Link>
          ) : null}
          <Link href={item.profileHref} className="text-accent hover:underline">
            View profile
          </Link>
        </div>
      </div>
    </details>
  );
}
