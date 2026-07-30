import type { StatusTone } from "@/lib/orchestration/person-status";
import type { Tone } from "@/app/ui/tone";

// The one mapping from describePersonStatus's operational tone onto the
// design system's visual tone. Previously duplicated identically on the
// person page and the event page; centralised here so a third page (the
// dashboard, the history page) can render the same status consistently.
//
// "unknown" (in progress, or no check-in yet) is deliberately neutral —
// neither reassuring nor worrying, since nothing has been established either
// way. "unresolved" is its own tone, not a shade of "attention": DEC-011's
// ATTENTION_UNRESOLVED is a finished, autonomous dead end, distinct from a
// cascade still in progress.
export const STATUS_TONE: Record<StatusTone, Tone> = {
  calm: "calm",
  attention: "attention",
  unresolved: "unresolved",
  unknown: "neutral",
};
