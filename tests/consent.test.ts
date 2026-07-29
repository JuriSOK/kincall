import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsentNotConfirmedError } from "@/lib/database/errors";
import { InMemoryRepository } from "@/lib/database/in-memory-repository";
import { seedRepository } from "@/lib/database/seed";
import { startDemoEvent, type EngineDeps } from "@/lib/orchestration/engine";
import { describeCallReadiness } from "@/lib/orchestration/person-status";
import { RecordingCalleAdapter } from "./support/recording-adapter";

// PRODUCT_SPECIFICATION.md §17.1 / DEC-007: KinCall only calls people who have
// agreed to receive automated calls. Enforced in every mode, because consent is
// a property of the person, not of whether the dialling is real.

function deps(): EngineDeps & { repository: InMemoryRepository; adapter: RecordingCalleAdapter } {
  const repository = new InMemoryRepository();
  seedRepository(repository);
  const adapter = new RecordingCalleAdapter();
  return { repository, calleAdapter: adapter, adapter };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("consent — the vulnerable person", () => {
  it("refuses to start a check-in and creates no event at all", async () => {
    const d = deps();
    const person = await d.repository.createPerson({
      firstName: "Sophie",
      phone: "+33698765432",
      preferredLanguage: "fr-FR",
      conversationProfile: "standard",
      preferredCallTime: "09:00",
      interests: [],
      consentStatus: "pending",
    });

    await expect(startDemoEvent(person.id, d)).rejects.toThrow(ConsentNotConfirmedError);

    // Checked before createEvent, so no orphaned event is left behind.
    expect(await d.repository.listEvents(person.id)).toHaveLength(0);
    expect(d.adapter.startCompanionCallSpy).not.toHaveBeenCalled();
  });

  it.each(["pending", "declined"] as const)("refuses when consent is %s", async (consentStatus) => {
    const d = deps();
    const person = await d.repository.createPerson({
      firstName: "Sophie",
      phone: "+33698765432",
      preferredLanguage: "fr-FR",
      conversationProfile: "standard",
      preferredCallTime: "09:00",
      interests: [],
      consentStatus,
    });
    await expect(startDemoEvent(person.id, d)).rejects.toThrow(ConsentNotConfirmedError);
  });

  it("still runs for the seeded, consented demo person", async () => {
    const d = deps();
    const event = await startDemoEvent("person_marie", d);
    expect(event.status).toBe("CASE_CLOSED");
  });
});

describe("consent — a trusted contact", () => {
  it("is skipped via FAMILY_CALL_NOT_POSSIBLE and never dialled", async () => {
    const d = deps();
    // Julie has not consented; Marc and Nicole are untouched.
    const julie = (await d.repository.getTrustedContacts("person_marie"))[0];
    d.repository.seedContact({ ...julie, consentStatus: "pending" });

    const event = await startDemoEvent("person_marie", d);

    // The cascade reaches Julie, cannot call her, and escalates rather than
    // silently skipping to Marc — a person nobody consented to call must be a
    // visible, actionable state.
    expect(event.status).toBe("HUMAN_REVIEW_REQUIRED");
    const messages = (await d.repository.listTimeline(event.id)).map((entry) => entry.message);
    expect(
      messages.some((message) => message.includes("cannot call Julie") && message.includes("§17.1"))
    ).toBe(true);
    expect(messages).not.toContain("Calling Julie");
    expect(d.adapter.contactsCalled()).toHaveLength(0);
  });

  it("applies in fake mode too, where nothing is really dialled", async () => {
    vi.stubEnv("CALLE_MODE", "fake");
    const d = deps();
    const julie = (await d.repository.getTrustedContacts("person_marie"))[0];
    d.repository.seedContact({ ...julie, consentStatus: "declined" });

    const event = await startDemoEvent("person_marie", d);
    expect(event.status).toBe("HUMAN_REVIEW_REQUIRED");
  });
});

describe("describeCallReadiness", () => {
  it("reports missing consent ahead of anything else", () => {
    const readiness = describeCallReadiness({
      id: "contact_sophie",
      firstName: "Sophie",
      phone: "+33639980500",
      consentStatus: "pending",
    });
    expect(readiness.kind).toBe("consent_missing");
  });

  it("treats a fiction number as expected in fake mode and missing in live mode", () => {
    const subject = {
      id: "contact_sophie",
      firstName: "Sophie",
      phone: "+33639980500",
      consentStatus: "confirmed" as const,
    };

    vi.stubEnv("CALLE_MODE", "fake");
    expect(describeCallReadiness(subject).kind).toBe("fake_mode");

    vi.stubEnv("CALLE_MODE", "live");
    const live = describeCallReadiness(subject);
    expect(live.kind).toBe("phone_missing");
    // Actionable and masked: names the variable, never prints the number.
    expect(live.kind === "phone_missing" && live.message).toContain("KINCALL_PHONE_CONTACT_SOPHIE");
    expect(live.kind === "phone_missing" && live.message).not.toContain("+33639980500");
  });

  it("is ready once a real number is configured for that exact entity", () => {
    vi.stubEnv("CALLE_MODE", "live");
    vi.stubEnv("KINCALL_PHONE_CONTACT_SOPHIE", "+33611111111");
    expect(
      describeCallReadiness({
        id: "contact_sophie",
        firstName: "Sophie",
        phone: "+33611111111",
        consentStatus: "confirmed",
      }).kind
    ).toBe("ready");
  });
});
