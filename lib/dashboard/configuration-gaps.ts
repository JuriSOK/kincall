import type { CallReadiness } from "@/lib/orchestration/person-status";
import type { TrustedContact, VulnerablePerson } from "@/lib/database/types";

// The dashboard's "Configuration gaps" section (§7B). Pure and independent of
// how readiness was computed — callers pass already-resolved CallReadiness
// values (from lib/orchestration/person-status.ts's describeCallReadiness),
// so this module never re-derives consent or phone logic and can never
// silently drift from it.
export type ConfigurationGapKind =
  | "consent_missing"
  | "no_active_circle"
  | "contact_consent_missing"
  | "phone_missing";

export interface ConfigurationGap {
  personId: string;
  personName: string;
  kind: ConfigurationGapKind;
  message: string;
  href: string;
}

// One person's gaps. `contactReadiness` must be aligned by index with
// `activeContacts` (i.e. the same array a caller maps describeCallReadiness
// over) — a mismatched pairing would blame the wrong contact's readiness on
// another one, so callers must build them together.
export function detectConfigurationGaps(
  person: Pick<VulnerablePerson, "id" | "firstName">,
  personReadiness: CallReadiness,
  activeContacts: Pick<TrustedContact, "id" | "firstName">[],
  contactReadiness: CallReadiness[]
): ConfigurationGap[] {
  const gaps: ConfigurationGap[] = [];
  const profileHref = `/people/${person.id}`;
  const circleHref = `/people/${person.id}/contacts`;

  if (personReadiness.kind === "consent_missing") {
    gaps.push({
      personId: person.id,
      personName: person.firstName,
      kind: "consent_missing",
      message: personReadiness.message,
      href: profileHref,
    });
  }

  // Only ever flagged when the current data can actually prove it: fake_mode
  // means nothing is dialled, so a fiction number is expected, not a gap.
  if (personReadiness.kind === "phone_missing") {
    gaps.push({
      personId: person.id,
      personName: person.firstName,
      kind: "phone_missing",
      message: `Phone configuration missing for ${person.firstName}. ${personReadiness.message}`,
      href: profileHref,
    });
  }

  if (activeContacts.length === 0) {
    gaps.push({
      personId: person.id,
      personName: person.firstName,
      kind: "no_active_circle",
      message: `${person.firstName} has no trusted contacts yet — a check-in that needs attention can only end unresolved.`,
      href: circleHref,
    });
  }

  const pendingContacts = activeContacts.filter(
    (_contact, index) => contactReadiness[index]?.kind === "consent_missing"
  );
  if (pendingContacts.length > 0) {
    const plural = pendingContacts.length > 1;
    gaps.push({
      personId: person.id,
      personName: person.firstName,
      kind: "contact_consent_missing",
      message: `${pendingContacts.length} trusted contact${plural ? "s" : ""} for ${person.firstName} ${plural ? "have" : "has"} not confirmed consent, and will be skipped by the cascade.`,
      href: circleHref,
    });
  }

  return gaps;
}
