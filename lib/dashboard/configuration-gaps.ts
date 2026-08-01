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
  | "phone_missing"
  // Stage E (DEC-017): contacts exist, but none would actually be tried —
  // the overarching alarm, whatever the mix of reasons.
  | "no_eligible_contact"
  // A more specific, more actionable variant of the above: every contact is
  // individually disabled (re-enabling one is the direct fix), regardless of
  // consent.
  | "all_contacts_disabled"
  // Informational only — see this gap's own construction below for why it
  // is never treated as a blocking error.
  | "no_primary_contact";

export interface ConfigurationGap {
  personId: string;
  personName: string;
  kind: ConfigurationGapKind;
  message: string;
  href: string;
  // Stage E: "no_primary_contact" is an informational suggestion, never a
  // blocking error (Stage E brief §10) — every other kind is "attention".
  // Absent (treated as "attention") for every pre-Stage-E kind, so existing
  // callers/tests that never set this keep their exact current rendering.
  severity?: "attention" | "informational";
}

// One person's gaps. `contactReadiness` must be aligned by index with
// `activeContacts` (i.e. the same array a caller maps describeCallReadiness
// over) — a mismatched pairing would blame the wrong contact's readiness on
// another one, so callers must build them together.
export function detectConfigurationGaps(
  person: Pick<VulnerablePerson, "id" | "firstName">,
  personReadiness: CallReadiness,
  activeContacts: Pick<TrustedContact, "id" | "firstName" | "enabled" | "isPrimary">[],
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

  // Stage E (DEC-017). Only meaningful once a circle exists at all — an empty
  // circle is already covered by "no_active_circle" above, and both firing
  // together would be a redundant double warning for the same underlying fact.
  if (activeContacts.length > 0) {
    const eligibleCount = activeContacts.filter(
      (contact, index) => contact.enabled && contactReadiness[index]?.kind !== "consent_missing"
    ).length;
    const allDisabled = activeContacts.every((contact) => !contact.enabled);

    if (eligibleCount === 0) {
      gaps.push({
        personId: person.id,
        personName: person.firstName,
        kind: "no_eligible_contact",
        message: `None of ${person.firstName}'s trusted contacts would currently be tried — a check-in that needs attention can only end unresolved.`,
        href: circleHref,
      });
    }

    if (allDisabled) {
      gaps.push({
        personId: person.id,
        personName: person.firstName,
        kind: "all_contacts_disabled",
        message: `Every trusted contact for ${person.firstName} is disabled. Re-enable at least one to restore the cascade.`,
        href: circleHref,
      });
    }

    if (!activeContacts.some((contact) => contact.isPrimary)) {
      gaps.push({
        personId: person.id,
        personName: person.firstName,
        kind: "no_primary_contact",
        message: `${person.firstName} has no primary contact set yet.`,
        href: circleHref,
        severity: "informational",
      });
    }
  }

  return gaps;
}
