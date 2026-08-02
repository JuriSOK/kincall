import { describe, expect, it } from "vitest";
import { buildCompanionTask } from "@/prompts/companion-agent";
import type { VulnerablePerson } from "@/lib/database/types";

function person(overrides: Partial<VulnerablePerson> = {}): VulnerablePerson {
  return {
    id: "person_marie",
    firstName: "Marie",
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
    ...overrides,
  };
}

describe("buildCompanionTask — identification and safety boundaries", () => {
  it("identifies KinCall as an automated assistant and forbids impersonation", () => {
    const task = buildCompanionTask(person());
    expect(task).toMatch(/automated assistant/i);
    expect(task).toMatch(/do not claim to be a family member/i);
  });

  it("never promises a specific person will visit or call", () => {
    const task = buildCompanionTask(person());
    expect(task).toMatch(/never promise that a specific person will visit or call/i);
  });

  it("forbids diagnosing, rating severity, or giving medical advice", () => {
    const task = buildCompanionTask(person());
    expect(task).toMatch(/do not diagnose/i);
    expect(task).toMatch(/do not give medical or treatment advice/i);
  });

  it("never claims KinCall will contact an emergency service", () => {
    const task = buildCompanionTask(person());
    expect(task).toMatch(/you are not an emergency service/i);
    expect(task).toMatch(/contact their local emergency number themselves/i);
  });

  it("never contains the person's phone number", () => {
    const subject = person();
    const task = buildCompanionTask(subject);
    expect(task).not.toContain(subject.phone);
    expect(task).not.toContain("639980001");
  });
});

// The Scenario 7 live-test failure: the check-in introduction was repeated
// about three times into a single voicemail. MAX_COMPANION_ATTEMPTS is 2, so
// three repetitions cannot have been three attempts — it happened inside one
// call, because the prompt's only closing instruction was conditioned on
// learning how the person is, which never happens when nobody answers.
describe("buildCompanionTask — bounded behaviour when nobody answers", () => {
  it("instructs the agent to say its introduction exactly once", () => {
    const task = buildCompanionTask(person());
    expect(task).toMatch(/say your introduction once/i);
    expect(task).toMatch(/do not repeat it/i);
    expect(task).toMatch(/do not start the check-in again from the beginning/i);
  });

  it("gives the no-reply path its own explicit ending: one closing line, then hang up", () => {
    const task = buildCompanionTask(person());
    expect(task).toMatch(/if nobody replies to you/i);
    expect(task).toMatch(/at most one short closing line and end the call/i);
    expect(task).toMatch(/do not keep talking/i);
  });

  it("still keeps the voicemail message itself short and detail-free", () => {
    const task = buildCompanionTask(person());
    expect(task).toMatch(/do not ask any wellbeing questions/i);
    expect(task).toMatch(/do not leave any detail about their situation/i);
  });

  it("describes what the agent can hear, never a platform voicemail signal", () => {
    // CALL-E exposes no answering-machine detection (DEC-011), so the prompt
    // must not imply KinCall can confirm a voicemail was reached.
    const task = buildCompanionTask(person());
    expect(task).toMatch(/silence, a recorded greeting, or only your own voice/i);
    expect(task).not.toMatch(/voicemail detection/i);
    expect(task).not.toMatch(/answering[- ]machine detection/i);
  });
});

describe("buildCompanionTask — per-profile conversation guidance", () => {
  it.each([
    ["cognitive_friendly", /short sentences, ask one question at a time/i],
    ["speech_difficulty", /leave longer pauses, do not interrupt/i],
    ["standard", /warm and open-ended/i],
  ])("applies the %s guidance", (profile, expected) => {
    const task = buildCompanionTask(person({ conversationProfile: profile }));
    expect(task).toMatch(expected);
  });

  it("mentions interests only when some are recorded", () => {
    expect(buildCompanionTask(person({ interests: ["gardening"] }))).toContain("gardening");
    expect(buildCompanionTask(person({ interests: [] }))).not.toMatch(/interest in:/i);
  });
});
