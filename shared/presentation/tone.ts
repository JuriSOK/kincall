/**
 * The shared visual vocabulary for outcome and status.
 *
 * Four tones, no more, and every one of them is *operational* — none of them
 * expresses medical severity, which KinCall never assesses (DEC-011,
 * PRODUCT_SPECIFICATION.md §7.5). `unresolved` exists specifically so
 * ATTENTION_UNRESOLVED reads as distinct from both "nothing was wrong" and
 * "somebody is handling it", without being dressed up as an emergency.
 *
 * This module is deliberately data-only so both Server and Client Components
 * can import it.
 */
export type Tone = "neutral" | "calm" | "attention" | "unresolved";

/** Filled treatment: badges and pills. */
export const TONE_BADGE: Record<Tone, string> = {
  neutral: "bg-sunken text-muted border-line",
  calm: "bg-calm-bg text-calm-ink border-calm-line",
  attention: "bg-attention-bg text-attention-ink border-attention-line",
  unresolved: "bg-unresolved-bg text-unresolved-ink border-unresolved-line",
};

/** Panel treatment: notices and callouts. */
export const TONE_PANEL: Record<Tone, string> = {
  neutral: "bg-sunken border-line text-muted",
  calm: "bg-calm-bg border-calm-line text-calm-ink",
  attention: "bg-attention-bg border-attention-line text-attention-ink",
  unresolved: "bg-unresolved-bg border-unresolved-line text-unresolved-ink",
};

/** Left-edge accent, for timeline rows and list items. */
export const TONE_EDGE: Record<Tone, string> = {
  neutral: "border-l-line-strong",
  calm: "border-l-calm-line",
  attention: "border-l-attention-line",
  unresolved: "border-l-unresolved-line",
};
