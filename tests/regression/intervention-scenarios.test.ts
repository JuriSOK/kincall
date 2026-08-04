import { describe, expect, it } from "vitest";
import type { FakeScenarioId } from "@/backend/integrations/calle/fake-adapter";
import { InMemoryRepository } from "@/backend/persistence/in-memory-repository";
import { seedRepository } from "@/backend/persistence/seed";
import { startDemoEvent, type EngineDeps } from "@/backend/orchestration/engine";
import { buildInterventionSummary } from "@/backend/presentation/intervention-summary";
import { buildHistoryEventView } from "@/backend/presentation/history-view";
import { RecordingCalleAdapter } from "../support/recording-adapter";

// Stage F (docs/DECISION_LOG.md DEC-019): the presentation layer, run against
// the REAL engine and the REAL fake scenarios end to end — never against a
// hand-written fixture of what the persisted data is assumed to look like.
// This is what proves the displayed sentence matches what actually got stored,
// and it is why backend/integrations/calle/fake-adapter.ts was not edited for Stage F: the
// expected strings below are derived from its existing results, not the other
// way round.

async function runScenario(scenario: FakeScenarioId) {
  const repository = new InMemoryRepository();
  seedRepository(repository);
  const adapter = new RecordingCalleAdapter({ scenario });
  const deps: EngineDeps = { repository, calleAdapter: adapter };

  const event = await startDemoEvent("person_marie", deps);
  const callEvents = await repository.listCallEvents(event.id);
  const contacts = await repository.getTrustedContacts("person_marie");
  const timeline = (await repository.listTimeline(event.id)).map((entry) => entry.message);

  return {
    event,
    callEvents,
    contacts,
    timeline,
    adapter,
    summary: buildInterventionSummary(event, callEvents, contacts),
    placedCalls: adapter
      .startFamilyCallSpy.mock.calls.map(
        (call) => `${call[0].contact.id}#${call[0].attemptNumber}`
      ),
  };
}

describe("Stage F presentation — Marie baseline", () => {
  it("names Marc, a visit, and 17:30, with the disclaimer", async () => {
    const { event, summary } = await runScenario("marie_baseline");

    expect(event.status).toBe("CASE_CLOSED");
    expect(summary).not.toBeNull();
    expect(summary!.contactName).toBe("Marc");
    expect(summary!.relationship).toBe("son");
    expect(summary!.action).toBe("Will visit");
    expect(summary!.estimatedTimeText).toBe("at 17:30");
    expect(summary!.concise).toBe("Marc will visit at 17:30.");
    expect(summary!.disclaimer).toMatch(/has not verified/i);
  });
});

describe("Stage F presentation — explicit help", () => {
  it("names Julie and her persisted 'this afternoon' wording", async () => {
    const { event, summary } = await runScenario("explicit_help");

    expect(event.status).toBe("CASE_CLOSED");
    expect(summary!.contactName).toBe("Julie");
    expect(summary!.relationship).toBe("daughter");
    // The fake scenario persists intervention_type "visit" here — displayed
    // as stored, not adjusted to make the sentence prettier.
    expect(summary!.concise).toBe("Julie will visit this afternoon.");
    expect(summary!.estimatedTimeText).toBe("this afternoon");
  });
});

describe("Stage F presentation — other incident", () => {
  it("names Julie and her persisted 'this evening' wording", async () => {
    const { event, summary } = await runScenario("other_incident");

    expect(event.status).toBe("CASE_CLOSED");
    expect(summary!.contactName).toBe("Julie");
    expect(summary!.concise).toBe("Julie will visit this evening.");
  });
});

describe("Stage F presentation — person unreachable", () => {
  it("names Julie and her persisted 'within the hour' wording", async () => {
    const { event, summary } = await runScenario("person_unreachable");

    expect(event.status).toBe("CASE_CLOSED");
    expect(summary!.contactName).toBe("Julie");
    expect(summary!.concise).toBe("Julie will visit within the hour.");
    expect(summary!.estimatedTimeText).toBe("within the hour");
  });
});

describe("Stage F presentation — all contacts unavailable", () => {
  it("produces NO confirmation and names nobody as accepting", async () => {
    const { event, summary, contacts, callEvents } = await runScenario(
      "all_contacts_unavailable"
    );

    expect(event.status).toBe("ATTENTION_UNRESOLVED");
    expect(summary).toBeNull();

    // Marc DECLINED in this scenario (answered: yes, can_intervene: no) — the
    // one case most at risk of being misread as acceptance.
    const marcCall = callEvents.find((call) => call.contactId === "contact_marc");
    expect(marcCall).toBeDefined();
    expect(buildInterventionSummary(event, callEvents, contacts)).toBeNull();
  });

  it("shows no intervention line in a dashboard/history row either", async () => {
    const { event, callEvents, contacts } = await runScenario("all_contacts_unavailable");
    const view = buildHistoryEventView(event, "Marie", callEvents, null, contacts);
    expect(view.interventionSummary).toBeNull();
  });
});

describe("Stage F — the row and the event page never disagree", () => {
  it.each([
    ["marie_baseline", "Marc will visit at 17:30."],
    ["explicit_help", "Julie will visit this afternoon."],
    ["other_incident", "Julie will visit this evening."],
    ["person_unreachable", "Julie will visit within the hour."],
  ] as const)("%s row line matches the card's own sentence", async (scenario, expected) => {
    const { event, callEvents, contacts, summary } = await runScenario(scenario);
    const view = buildHistoryEventView(event, "Marie", callEvents, null, contacts);

    expect(view.interventionSummary).toBe(expected);
    expect(view.interventionSummary).toBe(summary!.concise);
  });

  it("falls back to neutral wording when contacts cannot be resolved", async () => {
    const { event, callEvents } = await runScenario("marie_baseline");
    // A caller with no contact records (e.g. an archived person's events on
    // the dashboard) still reports the commitment — it genuinely happened —
    // just without naming who made it. No name is invented.
    const view = buildHistoryEventView(event, "Marie", callEvents, null, []);
    expect(view.interventionSummary).toBe("A trusted contact will visit at 17:30.");
    expect(view.interventionSummary).not.toContain("Marc");
  });
});

// The Stage-E regression net (tests/contact-order-cascade.test.ts) already
// pins call order, attempts and terminal status. This asserts the same facts
// once more from the Stage-F entry point, so a presentation change that
// somehow perturbed the engine could not pass unnoticed here either.
describe("Stage F changed no orchestration behaviour", () => {
  it.each([
    ["marie_baseline", ["contact_julie#1", "contact_julie#2", "contact_marc#1"], "CASE_CLOSED"],
    ["explicit_help", ["contact_julie#1"], "CASE_CLOSED"],
    ["other_incident", ["contact_julie#1"], "CASE_CLOSED"],
    ["person_unreachable", ["contact_julie#1"], "CASE_CLOSED"],
    [
      "all_contacts_unavailable",
      [
        "contact_julie#1",
        "contact_julie#2",
        "contact_marc#1",
        "contact_nicole#1",
        "contact_nicole#2",
      ],
      "ATTENTION_UNRESOLVED",
    ],
  ] as const)("%s keeps its exact call order and terminal status", async (scenario, calls, status) => {
    const { placedCalls, event, timeline } = await runScenario(scenario);

    expect(placedCalls).toEqual(calls);
    expect(event.status).toBe(status);
    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
    // The timeline is still written by the engine, not by presentation.
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline).toContain("Check-in call started");
  });
});
