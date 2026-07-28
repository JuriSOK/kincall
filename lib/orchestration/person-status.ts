import type { EventRecord, TrustedContact, VulnerablePerson } from "../database/types";
import { getCalleMode } from "../calle/adapter";
import { phoneEnvVarFor } from "../database/seed";
import { describeUnusablePhone } from "../phone";

// PRODUCT_SPECIFICATION.md §14.2's "Status" line, derived from the person's
// most recent event.
//
// Exhaustive over EventStatus with a `never`-typed default, the same shape as
// describeAction/describeOwnership on the event page: a newly added status
// fails typecheck here rather than silently falling through to a reassuring
// message it was never checked against.
export type StatusTone = "calm" | "attention" | "unknown";

export interface PersonStatus {
  label: string;
  tone: StatusTone;
}

export function describePersonStatus(event: EventRecord | undefined): PersonStatus {
  if (!event) return { label: "No check-in yet", tone: "unknown" };

  switch (event.status) {
    case "SCHEDULED":
    case "CALLING_PERSON":
    case "CONVERSATION_IN_PROGRESS":
      return { label: "Check-in in progress", tone: "unknown" };
    case "ANALYSING_CONVERSATION":
      return { label: "Analysing the conversation", tone: "unknown" };
    case "PERSON_DID_NOT_ANSWER":
      return { label: "Not reached — a retry is owed", tone: "attention" };
    case "ATTENTION_REQUIRED":
      return { label: "Needs attention", tone: "attention" };
    case "CALLING_TRUSTED_CONTACT":
    case "CONTACT_DID_NOT_ANSWER":
    case "CONTACT_DECLINED":
    case "CONTACT_CONFIRMED":
      return { label: "Contacting the trusted circle", tone: "attention" };
    case "HUMAN_REVIEW_REQUIRED":
      return { label: "Human review required", tone: "attention" };
    case "NO_ACTION_REQUIRED":
    case "CASE_CLOSED":
      return event.decision === "CONTACT_TRUSTED_PERSON"
        ? { label: "Resolved — a trusted contact stepped in", tone: "calm" }
        : { label: "All well at the last check-in", tone: "calm" };
    default: {
      const exhaustive: never = event.status;
      return exhaustive;
    }
  }
}

// Whether this person or contact can actually be called, and why not.
//
// DEC-006: a stored number is always reserved-for-fiction, and the live number
// comes from KINCALL_*_PHONE. DEC-007: consent is required in every mode.
export type CallReadiness =
  | { kind: "ready" }
  | { kind: "consent_missing"; message: string }
  | { kind: "phone_missing"; message: string }
  | { kind: "fake_mode" };

export function describeCallReadiness(
  subject: Pick<VulnerablePerson | TrustedContact, "id" | "firstName" | "phone" | "consentStatus">
): CallReadiness {
  if (subject.consentStatus !== "confirmed") {
    return {
      kind: "consent_missing",
      message: `${subject.firstName} has not confirmed consent to receive automated calls, so KinCall will not call them.`,
    };
  }

  // Reuses the single source of truth for "may this number be dialled?", which
  // already masks the number and names the variable to set.
  const unusable = describeUnusablePhone(subject.phone, phoneEnvVarFor(subject.id));
  if (!unusable) return { kind: "ready" };

  // In fake mode nothing is dialled, so a fiction number is expected rather
  // than a problem worth warning about.
  return getCalleMode() === "live"
    ? { kind: "phone_missing", message: unusable }
    : { kind: "fake_mode" };
}
