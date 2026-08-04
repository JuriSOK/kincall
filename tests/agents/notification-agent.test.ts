import { describe, expect, it } from "vitest";
import { buildPersonNotificationTask } from "@/backend/agents/notification/prompt";
import type { VulnerablePerson } from "@/shared/domain/types";

const claire: VulnerablePerson = {
  id: "person_claire",
  firstName: "Claire",
  phone: "+33639980001",
  preferredLanguage: "fr-FR",
  conversationProfile: "standard",
  preferredCallTime: "09:00",
  interests: [],
  consentStatus: "confirmed",
  archivedAt: null,
  timezone: "Europe/Paris",
  avatarKey: null,
  conversationNotes: null,
  checkInDays: [1, 2, 3, 4, 5, 6, 7],
  scheduleState: "active",
};

const OUTCOME = "Marc confirmed that they will visit you this afternoon.";

describe("buildPersonNotificationTask — speaks directly to the monitored person", () => {
  it("instructs a first-name greeting and second-person address thereafter", () => {
    const task = buildPersonNotificationTask(claire, OUTCOME);
    expect(task).toMatch(/speaking directly to Claire/i);
    expect(task).toMatch(/greet them by their first name once/i);
    expect(task).toMatch(/address them as "you"/i);
  });

  it("forbids referring to the recipient in the third person", () => {
    const task = buildPersonNotificationTask(claire, OUTCOME);
    expect(task).toMatch(/never refer to Claire in the third person/i);
    expect(task).toMatch(/say "you", not "Claire"/i);
  });

  it("forbids reopening or repeating the original check-in context", () => {
    const task = buildPersonNotificationTask(claire, OUTCOME);
    expect(task).toMatch(/do not mention or repeat what the earlier call was about/i);
    expect(task).toMatch(/do not reopen that subject/i);
  });

  it("carries the composed outcome verbatim and nothing else about the situation", () => {
    const task = buildPersonNotificationTask(claire, OUTCOME);
    expect(task).toContain(OUTCOME);
    expect(task).not.toMatch(/administrative document|fell yesterday|difficult to walk/i);
  });
});

describe("buildPersonNotificationTask — safety boundaries", () => {
  it("identifies as an automated assistant and forbids impersonation", () => {
    const task = buildPersonNotificationTask(claire, OUTCOME);
    expect(task).toMatch(/automated assistant/i);
    expect(task).toMatch(/do not claim to be a family member/i);
  });

  it("never claims the intervention happened, was verified, or that she is safe", () => {
    const task = buildPersonNotificationTask(claire, OUTCOME);
    expect(task).toMatch(/do not say that anything has already been done/i);
    expect(task).toMatch(/do not say they are safe or fine/i);
  });

  it("forbids promising further action or restarting the cascade", () => {
    const task = buildPersonNotificationTask(claire, OUTCOME);
    expect(task).toMatch(/do not promise that anything further will happen/i);
    expect(task).toMatch(/do not offer to call anyone else/i);
  });

  it("keeps the bounded ending when nobody replies", () => {
    const task = buildPersonNotificationTask(claire, OUTCOME);
    expect(task).toMatch(/say the message once\. do not repeat it/i);
    expect(task).toMatch(/at most one short closing line/i);
  });

  it("leaks no phone number, raw JSON, enum name or secret", () => {
    const task = buildPersonNotificationTask(claire, OUTCOME);
    expect(task).not.toContain(claire.phone);
    expect(task).not.toMatch(/\+\d{6,}/);
    expect(task).not.toContain("{");
    for (const forbidden of ["intervention_type", "can_intervene", "person_reached", "contact_id"]) {
      expect(task).not.toContain(forbidden);
    }
    expect(task).toMatch(/never describe an internal field name/i);
  });
});
