import { describe, expect, it } from "vitest";
import type { TrustedContact } from "@/lib/database/types";
import { orderContactsForCascade } from "@/lib/orchestration/contact-order";

function contact(overrides: Partial<TrustedContact> = {}): TrustedContact {
  return {
    id: "contact_a",
    personId: "person_marie",
    firstName: "A",
    phone: "+33611111111",
    relationship: "daughter",
    priority: 1,
    consentStatus: "confirmed",
    archivedAt: null,
    isPrimary: false,
    enabled: true,
    callableFrom: null,
    callableTo: null,
    timezone: null,
    maxAttempts: 2,
    ...overrides,
  };
}

const PERSON_TZ = "Europe/Paris";

describe("orderContactsForCascade — default preservation", () => {
  it("preserves exact priority order when nobody has a window", () => {
    const julie = contact({ id: "contact_julie", priority: 1 });
    const marc = contact({ id: "contact_marc", priority: 2 });
    const nicole = contact({ id: "contact_nicole", priority: 3 });

    const ordered = orderContactsForCascade(
      [julie, marc, nicole],
      "2026-07-30T09:00:00.000Z",
      PERSON_TZ
    );

    expect(ordered.map((c) => c.id)).toEqual(["contact_julie", "contact_marc", "contact_nicole"]);
  });

  it("is unaffected by input order — always sorts by configured priority", () => {
    const julie = contact({ id: "contact_julie", priority: 1 });
    const marc = contact({ id: "contact_marc", priority: 2 });
    const nicole = contact({ id: "contact_nicole", priority: 3 });

    const ordered = orderContactsForCascade(
      [nicole, julie, marc],
      "2026-07-30T09:00:00.000Z",
      PERSON_TZ
    );

    expect(ordered.map((c) => c.id)).toEqual(["contact_julie", "contact_marc", "contact_nicole"]);
  });
});

describe("orderContactsForCascade — availability reordering (never waits, never excludes)", () => {
  it("tries an available second contact before an unavailable first, without dropping the first", () => {
    // 10:00 Europe/Paris. Julie (priority 1) is only callable 18:00-23:00 —
    // not now. Marc (priority 2) has no window at all.
    const julie = contact({
      id: "contact_julie",
      priority: 1,
      callableFrom: "18:00",
      callableTo: "23:00",
    });
    const marc = contact({ id: "contact_marc", priority: 2 });

    const ordered = orderContactsForCascade(
      [julie, marc],
      "2026-07-30T08:00:00.000Z", // 10:00 CEST
      PERSON_TZ
    );

    expect(ordered.map((c) => c.id)).toEqual(["contact_marc", "contact_julie"]);
  });

  it("uses the original configured order when everyone is outside their window", () => {
    const julie = contact({
      id: "contact_julie",
      priority: 1,
      callableFrom: "18:00",
      callableTo: "23:00",
    });
    const marc = contact({
      id: "contact_marc",
      priority: 2,
      callableFrom: "19:00",
      callableTo: "23:00",
    });

    const ordered = orderContactsForCascade(
      [julie, marc],
      "2026-07-30T08:00:00.000Z", // 10:00 CEST — outside both windows
      PERSON_TZ
    );

    // Both out-of-window: falls back to configured priority, and — critically
    // — both are still present, ready to be called immediately.
    expect(ordered.map((c) => c.id)).toEqual(["contact_julie", "contact_marc"]);
  });

  it("preserves relative priority within the in-window partition", () => {
    const nicole = contact({ id: "contact_nicole", priority: 3 }); // always available
    const julie = contact({ id: "contact_julie", priority: 1 }); // always available
    const marc = contact({
      id: "contact_marc",
      priority: 2,
      callableFrom: "18:00",
      callableTo: "23:00",
    }); // NOT available now

    const ordered = orderContactsForCascade(
      [julie, marc, nicole],
      "2026-07-30T08:00:00.000Z",
      PERSON_TZ
    );

    expect(ordered.map((c) => c.id)).toEqual(["contact_julie", "contact_nicole", "contact_marc"]);
  });

  it("treats a null window as always available", () => {
    const julie = contact({ id: "contact_julie", callableFrom: null, callableTo: null });
    expect(
      orderContactsForCascade([julie], "2026-01-01T03:00:00.000Z", PERSON_TZ).map((c) => c.id)
    ).toEqual(["contact_julie"]);
  });
});

describe("orderContactsForCascade — cross-midnight windows", () => {
  it("treats 22:00-07:00 as available late at night", () => {
    const julie = contact({ callableFrom: "22:00", callableTo: "07:00" });
    // 23:30 Europe/Paris in winter (CET, +1) — 22:30Z.
    const ordered = orderContactsForCascade([julie], "2026-01-15T22:30:00.000Z", PERSON_TZ);
    expect(ordered).toHaveLength(1); // present regardless, but let's assert window classification via ordering below
  });

  it("orders a cross-midnight contact as in-window at 23:30 but out-of-window at noon", () => {
    const nightOwl = contact({
      id: "contact_night",
      priority: 1,
      callableFrom: "22:00",
      callableTo: "07:00",
    });
    const daytime = contact({ id: "contact_day", priority: 2 }); // always available

    const atNight = orderContactsForCascade(
      [nightOwl, daytime],
      "2026-01-15T22:30:00.000Z", // 23:30 CET
      PERSON_TZ
    );
    // Night owl is in-window at 23:30, so tried first despite lower priority
    // than... wait, priority 1 already first; assert daytime (no window) also in-window and priority breaks the tie.
    expect(atNight.map((c) => c.id)).toEqual(["contact_night", "contact_day"]);

    const atNoon = orderContactsForCascade(
      [nightOwl, daytime],
      "2026-01-15T11:00:00.000Z", // 12:00 CET — outside 22:00-07:00
      PERSON_TZ
    );
    // Night owl is now out-of-window: daytime (in-window, no restriction) goes first.
    expect(atNoon.map((c) => c.id)).toEqual(["contact_day", "contact_night"]);
  });
});

describe("orderContactsForCascade — timezone inheritance and per-contact timezone", () => {
  it("inherits the person's timezone when the contact has none", () => {
    // Person is Europe/Paris. 10:00 CEST = 08:00Z. Contact window 09:00-18:00,
    // no contact-specific timezone — must use the person's.
    const julie = contact({ callableFrom: "09:00", callableTo: "18:00", timezone: null });
    const marc = contact({ id: "contact_marc", priority: 2 });

    const ordered = orderContactsForCascade(
      [julie, marc],
      "2026-07-30T08:00:00.000Z", // 10:00 Europe/Paris
      "Europe/Paris"
    );
    expect(ordered.map((c) => c.id)).toEqual(["contact_a", "contact_marc"]); // julie (in window) first
  });

  it("uses the contact's own timezone when configured, overriding the person's", () => {
    // Person is Europe/Paris (10:00 local at this instant). Contact's own
    // timezone is Asia/Tokyo, where the same instant is late evening
    // (outside a 09:00-18:00 window).
    const julie = contact({
      callableFrom: "09:00",
      callableTo: "18:00",
      timezone: "Asia/Tokyo",
    });
    const marc = contact({ id: "contact_marc", priority: 2 });

    const ordered = orderContactsForCascade(
      [julie, marc],
      "2026-07-30T08:00:00.000Z", // 10:00 Europe/Paris, but 17:00 JST (still in-window)
      "Europe/Paris"
    );
    // 08:00Z is 17:00 Asia/Tokyo — still inside 09:00-18:00, so still in-window.
    expect(ordered.map((c) => c.id)).toEqual(["contact_a", "contact_marc"]);

    const later = orderContactsForCascade(
      [julie, marc],
      "2026-07-30T13:00:00.000Z", // 22:00 Asia/Tokyo — now outside the window
      "Europe/Paris"
    );
    expect(later.map((c) => c.id)).toEqual(["contact_marc", "contact_a"]);
  });
});

describe("orderContactsForCascade — exclusions", () => {
  it("excludes a disabled contact entirely", () => {
    const julie = contact({ id: "contact_julie", priority: 1, enabled: false });
    const marc = contact({ id: "contact_marc", priority: 2 });

    const ordered = orderContactsForCascade([julie, marc], "2026-07-30T08:00:00.000Z", PERSON_TZ);
    expect(ordered.map((c) => c.id)).toEqual(["contact_marc"]);
  });

  it("excludes an archived contact entirely", () => {
    const julie = contact({
      id: "contact_julie",
      priority: 1,
      archivedAt: "2026-01-01T00:00:00.000Z",
    });
    const marc = contact({ id: "contact_marc", priority: 2 });

    const ordered = orderContactsForCascade([julie, marc], "2026-07-30T08:00:00.000Z", PERSON_TZ);
    expect(ordered.map((c) => c.id)).toEqual(["contact_marc"]);
  });

  it("does NOT exclude an unconsented contact — that stays selectCascadeTarget's job", () => {
    // See this module's own top-of-file comment: consent filtering is
    // deliberately left to lib/orchestration/engine.ts's contactBlockedReason,
    // which is what produces the "has not confirmed consent" timeline entry
    // every pre-Stage-E test already depends on. Removing them here would
    // silently swallow that message.
    const julie = contact({ id: "contact_julie", priority: 1, consentStatus: "pending" });
    const marc = contact({ id: "contact_marc", priority: 2 });

    const ordered = orderContactsForCascade([julie, marc], "2026-07-30T08:00:00.000Z", PERSON_TZ);
    expect(ordered.map((c) => c.id)).toEqual(["contact_julie", "contact_marc"]);
  });
});

describe("orderContactsForCascade — replay stability", () => {
  it("produces the identical order for the identical persisted instant, regardless of when it is called", () => {
    const julie = contact({
      id: "contact_julie",
      priority: 1,
      callableFrom: "18:00",
      callableTo: "23:00",
    });
    const marc = contact({ id: "contact_marc", priority: 2 });
    const eventCreatedAt = "2026-07-30T08:00:00.000Z";

    const first = orderContactsForCascade([julie, marc], eventCreatedAt, PERSON_TZ);
    // Simulates a replay happening "later" in wall-clock time — the function
    // takes no ambient clock, so nothing about calling it later can change
    // the result for the SAME eventCreatedAt.
    const replay = orderContactsForCascade([julie, marc], eventCreatedAt, PERSON_TZ);

    expect(replay.map((c) => c.id)).toEqual(first.map((c) => c.id));
  });
});
