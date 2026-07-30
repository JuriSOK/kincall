import { describe, expect, it } from "vitest";
import { detectConfigurationGaps } from "@/lib/dashboard/configuration-gaps";
import { groupByDay } from "@/lib/dashboard/group-by-day";
import { partitionUnresolvedEvents } from "@/lib/dashboard/partition-unresolved";
import type { EventRecord } from "@/lib/database/types";
import type { CallReadiness } from "@/lib/orchestration/person-status";

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "event_001",
    runId: "00000000-0000-0000-0000-000000000000",
    personId: "person_marie",
    status: "CASE_CLOSED",
    currentContactPriority: null,
    decision: "LOG_AND_CLOSE",
    decisionReason: null,
    createdAt: "2026-07-30T09:00:00.000Z",
    closedAt: "2026-07-30T09:10:00.000Z",
    ...overrides,
  };
}

const READY: CallReadiness = { kind: "ready" };
const CONSENT_MISSING: CallReadiness = {
  kind: "consent_missing",
  message: "Marie has not confirmed consent.",
};
const PHONE_MISSING: CallReadiness = { kind: "phone_missing", message: "No number configured." };
const FAKE_MODE: CallReadiness = { kind: "fake_mode" };

describe("detectConfigurationGaps", () => {
  const person = { id: "person_marie", firstName: "Marie" };

  it("flags missing person consent, linking to the profile", () => {
    const gaps = detectConfigurationGaps(person, CONSENT_MISSING, [], []);
    expect(gaps.some((g) => g.kind === "consent_missing" && g.href === "/people/person_marie")).toBe(
      true
    );
  });

  it("flags no active trusted circle, linking to the contacts page", () => {
    const gaps = detectConfigurationGaps(person, READY, [], []);
    expect(gaps).toEqual([
      expect.objectContaining({ kind: "no_active_circle", href: "/people/person_marie/contacts" }),
    ]);
  });

  it("flags a contact who has not confirmed consent", () => {
    const contacts = [{ id: "contact_julie", firstName: "Julie" }];
    const gaps = detectConfigurationGaps(person, READY, contacts, [CONSENT_MISSING]);
    expect(gaps).toEqual([
      expect.objectContaining({ kind: "contact_consent_missing" }),
    ]);
  });

  it("flags phone_missing only — never fake_mode, which is expected in fake mode", () => {
    const withPhoneMissing = detectConfigurationGaps(
      person,
      PHONE_MISSING,
      [{ id: "contact_julie", firstName: "Julie" }],
      [READY]
    );
    expect(withPhoneMissing.some((g) => g.kind === "phone_missing")).toBe(true);

    const withFakeMode = detectConfigurationGaps(
      person,
      FAKE_MODE,
      [{ id: "contact_julie", firstName: "Julie" }],
      [READY]
    );
    expect(withFakeMode).toEqual([]);
  });

  it("reports no gaps for a fully configured, ready person with a ready circle", () => {
    const contacts = [{ id: "contact_julie", firstName: "Julie" }];
    expect(detectConfigurationGaps(person, READY, contacts, [READY])).toEqual([]);
  });

  it("aligns contactReadiness with activeContacts by index, not by re-derivation", () => {
    const contacts = [
      { id: "contact_julie", firstName: "Julie" },
      { id: "contact_marc", firstName: "Marc" },
    ];
    // Only the second contact (Marc) is missing consent.
    const gaps = detectConfigurationGaps(person, READY, contacts, [READY, CONSENT_MISSING]);
    const gap = gaps.find((g) => g.kind === "contact_consent_missing");
    expect(gap?.message).toContain("1 trusted contact");
  });
});

describe("groupByDay", () => {
  it("preserves newest-day-first order from newest-first input", () => {
    const items = [
      { id: "a", dayKey: "2026-07-30" },
      { id: "b", dayKey: "2026-07-30" },
      { id: "c", dayKey: "2026-07-29" },
    ];
    const groups = groupByDay(items);
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-07-30", "2026-07-29"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("returns an empty list for no items", () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe("partitionUnresolvedEvents", () => {
  it("separates ATTENTION_UNRESOLVED from everything else, regardless of input order", () => {
    const events = [
      event({ id: "e1", status: "CASE_CLOSED" }),
      event({ id: "e2", status: "ATTENTION_UNRESOLVED" }),
      event({ id: "e3", status: "CALLING_TRUSTED_CONTACT" }),
    ];
    const { unresolved, rest } = partitionUnresolvedEvents(events);
    expect(unresolved.map((e) => e.id)).toEqual(["e2"]);
    expect(rest.map((e) => e.id)).toEqual(["e1", "e3"]);
  });

  it("never puts an unresolved event in `rest`", () => {
    const events = [event({ id: "e1", status: "ATTENTION_UNRESOLVED" })];
    const { rest } = partitionUnresolvedEvents(events);
    expect(rest).toEqual([]);
  });
});
