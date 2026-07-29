import { beforeEach, describe, expect, it } from "vitest";
import { POST as createPerson } from "@/app/api/people/route";
import { DELETE as deletePerson } from "@/app/api/people/[id]/route";
import { POST as createContact } from "@/app/api/people/[id]/contacts/route";
import { DELETE as deleteContact } from "@/app/api/people/[id]/contacts/[contactId]/route";
import { PATCH as reorderContacts } from "@/app/api/people/[id]/contacts/order/route";
import { getRepository } from "@/lib/database/store";
import { seedPendingFamilyCallIntent } from "./support/seed-calls";

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(url: string, body: unknown): Request {
  return new Request(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del(url: string): Request {
  return new Request(url, { method: "DELETE" });
}

const VALID_PERSON = {
  firstName: "Sophie",
  phone: "+33698765432",
  preferredLanguage: "fr-FR",
  conversationProfile: "standard",
  preferredCallTime: "09:00",
  interests: ["reading"],
  consentStatus: "confirmed",
};

describe("POST /api/people", () => {
  it("creates a profile and returns its id", async () => {
    const response = await createPerson(post("https://kincall.test/api/people", VALID_PERSON));
    expect(response.status).toBe(201);

    const { personId } = (await response.json()) as { personId: string };
    const person = await getRepository().getPerson(personId);
    expect(person?.firstName).toBe("Sophie");
  });

  // The browser is not a trusted source: the route re-validates everything the
  // form already checked.
  it("rejects an invalid payload and writes nothing", async () => {
    const before = (await getRepository().listPeople()).length;

    const response = await createPerson(
      post("https://kincall.test/api/people", { ...VALID_PERSON, preferredCallTime: "9am" })
    );

    expect(response.status).toBe(400);
    const { errors } = (await response.json()) as { errors: Record<string, string> };
    expect(errors).toHaveProperty("preferredCallTime");
    expect((await getRepository().listPeople()).length).toBe(before);
  });

  // DEC-008: a validated E.164 number is required and stored exactly as given.
  it("stores the supplied phone number exactly as given", async () => {
    const response = await createPerson(post("https://kincall.test/api/people", VALID_PERSON));
    const { personId } = (await response.json()) as { personId: string };

    const person = await getRepository().getPerson(personId);
    expect(person?.phone).toBe("+33698765432");
  });

  it("rejects a missing phone number and writes nothing", async () => {
    const before = (await getRepository().listPeople()).length;
    const { phone: _omit, ...withoutPhone } = VALID_PERSON;

    const response = await createPerson(post("https://kincall.test/api/people", withoutPhone));

    expect(response.status).toBe(400);
    const { errors } = (await response.json()) as { errors: Record<string, string> };
    expect(errors).toHaveProperty("phone");
    expect((await getRepository().listPeople()).length).toBe(before);
  });

  it("rejects a non-E.164 phone number", async () => {
    const response = await createPerson(
      post("https://kincall.test/api/people", { ...VALID_PERSON, phone: "0612345678" })
    );
    expect(response.status).toBe(400);
    const { errors } = (await response.json()) as { errors: Record<string, string> };
    expect(errors).toHaveProperty("phone");
  });

  // A real participant cannot be assigned a number LiveCalleAdapter already
  // refuses to dial (DEC-006/DEC-008).
  it("rejects a reserved-for-fiction phone number", async () => {
    const response = await createPerson(
      post("https://kincall.test/api/people", { ...VALID_PERSON, phone: "+33639980050" })
    );
    expect(response.status).toBe(400);
    const { errors } = (await response.json()) as { errors: Record<string, string> };
    expect(errors).toHaveProperty("phone");
  });

  it("normalizes common phone formatting before validating and storing", async () => {
    const response = await createPerson(
      post("https://kincall.test/api/people", {
        ...VALID_PERSON,
        phone: "+33 6 98 76 54 32",
      })
    );
    expect(response.status).toBe(201);
    const { personId } = (await response.json()) as { personId: string };
    expect((await getRepository().getPerson(personId))?.phone).toBe("+33698765432");
  });

  it("rejects a phone number smuggled into a free-text field", async () => {
    const response = await createPerson(
      post("https://kincall.test/api/people", {
        ...VALID_PERSON,
        interests: ["ring me on 06 12 34 56 78"],
      })
    );
    expect(response.status).toBe(400);
  });

  it("malformed JSON is a validation failure, not a crash", async () => {
    const response = await createPerson(
      new Request("https://kincall.test/api/people", { method: "POST", body: "{" })
    );
    expect(response.status).toBe(400);
  });
});

describe("POST /api/people/[id]/contacts", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it("appends a contact to the circle with the supplied phone stored exactly", async () => {
    const response = await createContact(
      post("https://kincall.test/api/people/person_marie/contacts", {
        firstName: "Paul",
        phone: "+33644444444",
        relationship: "neighbour",
        consentStatus: "confirmed",
      }),
      params("person_marie")
    );

    expect(response.status).toBe(201);
    const circle = await getRepository().getTrustedContacts("person_marie");
    // Appended, never inserted mid-cascade.
    const added = circle[circle.length - 1];
    expect(added.firstName).toBe("Paul");
    expect(added.phone).toBe("+33644444444");
  });

  it("404s for an unknown person", async () => {
    const response = await createContact(
      post("https://kincall.test/api/people/person_nope/contacts", {
        firstName: "Paul",
        phone: "+33644444444",
        relationship: "neighbour",
      }),
      params("person_nope")
    );
    expect(response.status).toBe(404);
  });

  it("rejects an invalid contact and writes nothing", async () => {
    const before = (await getRepository().getTrustedContacts("person_marie")).length;

    const response = await createContact(
      post("https://kincall.test/api/people/person_marie/contacts", {
        firstName: "Paul",
        phone: "+33644444444",
        relationship: "",
      }),
      params("person_marie")
    );

    expect(response.status).toBe(400);
    expect((await getRepository().getTrustedContacts("person_marie")).length).toBe(before);
  });

  it("rejects a reserved-for-fiction phone number and writes nothing", async () => {
    const before = (await getRepository().getTrustedContacts("person_marie")).length;

    const response = await createContact(
      post("https://kincall.test/api/people/person_marie/contacts", {
        firstName: "Paul",
        phone: "+33639980077",
        relationship: "neighbour",
      }),
      params("person_marie")
    );

    expect(response.status).toBe(400);
    const { errors } = (await response.json()) as { errors: Record<string, string> };
    expect(errors).toHaveProperty("phone");
    expect((await getRepository().getTrustedContacts("person_marie")).length).toBe(before);
  });
});

describe("PATCH /api/people/[id]/contacts/order", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  let circleIds: string[];

  beforeEach(async () => {
    circleIds = (await getRepository().getTrustedContacts("person_marie")).map((c) => c.id);
  });

  it("applies a valid reorder", async () => {
    const reversed = [...circleIds].reverse();

    const response = await reorderContacts(
      patch("https://kincall.test/api/people/person_marie/contacts/order", {
        orderedIds: reversed,
      }),
      params("person_marie")
    );

    expect(response.status).toBe(200);
    expect((await getRepository().getTrustedContacts("person_marie")).map((c) => c.id)).toEqual(
      reversed
    );
  });

  it.each([
    ["a duplicate", (ids: string[]) => [ids[0], ids[0], ...ids.slice(2)]],
    ["a missing id", (ids: string[]) => ids.slice(1)],
    ["a foreign id", (ids: string[]) => [...ids.slice(1), "contact_not_mine"]],
  ])("rejects %s with 400 and changes nothing", async (_label, mangle) => {
    const before = await getRepository().getTrustedContacts("person_marie");

    const response = await reorderContacts(
      patch("https://kincall.test/api/people/person_marie/contacts/order", {
        orderedIds: mangle(before.map((c) => c.id)),
      }),
      params("person_marie")
    );

    expect(response.status).toBe(400);
    expect(await getRepository().getTrustedContacts("person_marie")).toEqual(before);
  });

  it("404s for an unknown person", async () => {
    const response = await reorderContacts(
      patch("https://kincall.test/api/people/person_nope/contacts/order", { orderedIds: [] }),
      params("person_nope")
    );
    expect(response.status).toBe(404);
  });
});

// DEC-009: soft deletion is optional interface administration — server
// behaviour only. The confirmation dialog itself is client-side (native
// window.confirm()) and not exercised here; these tests prove the route
// behaves correctly regardless of what any confirmation UI decided to send.
//
// Each test creates its OWN fresh person (and contact, where relevant) rather
// than reusing the globally shared person_marie/contact_julie fixtures: the
// repository singleton persists across every test in this file, so scenarios
// that permanently mutate a seeded record (an open event, an archive) would
// otherwise leak into unrelated later tests.
describe("DELETE /api/people/[id]", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  async function freshPerson(firstName: string): Promise<string> {
    const created = await createPerson(
      post("https://kincall.test/api/people", { ...VALID_PERSON, firstName })
    );
    return ((await created.json()) as { personId: string }).personId;
  }

  it("archives a profile with no active event", async () => {
    const personId = await freshPerson("DeleteMe1");

    const response = await deletePerson(
      del(`https://kincall.test/api/people/${personId}`),
      params(personId)
    );

    expect(response.status).toBe(200);
    expect((await getRepository().getPerson(personId))?.archivedAt).not.toBeNull();
    // Archived people disappear from the home-page list.
    expect((await getRepository().listPeople()).map((p) => p.id)).not.toContain(personId);
  });

  it("404s for an unknown person", async () => {
    const response = await deletePerson(
      del("https://kincall.test/api/people/person_nope"),
      params("person_nope")
    );
    expect(response.status).toBe(404);
  });

  it("refuses with 409 while an active event is open, and archives nothing", async () => {
    const personId = await freshPerson("DeleteMe2");
    await getRepository().createEvent(personId); // SCHEDULED — not terminal

    const response = await deletePerson(
      del(`https://kincall.test/api/people/${personId}`),
      params(personId)
    );

    expect(response.status).toBe(409);
    const { error } = (await response.json()) as { error: string };
    expect(error).toMatch(/active check-in/i);
    expect((await getRepository().getPerson(personId))?.archivedAt).toBeNull();
    expect((await getRepository().listPeople()).map((p) => p.id)).toContain(personId);
  });

  it("is idempotent: deleting an already-archived profile succeeds again", async () => {
    const personId = await freshPerson("DeleteMe3");
    await deletePerson(del(`https://kincall.test/api/people/${personId}`), params(personId));

    const response = await deletePerson(
      del(`https://kincall.test/api/people/${personId}`),
      params(personId)
    );
    expect(response.status).toBe(200);
  });
});

describe("DELETE /api/people/[id]/contacts/[contactId]", () => {
  const params = (id: string, contactId: string) => ({ params: Promise.resolve({ id, contactId }) });

  async function freshPersonWithContact(
    personName: string,
    contactName: string
  ): Promise<{ personId: string; contactId: string }> {
    const created = await createPerson(
      post("https://kincall.test/api/people", { ...VALID_PERSON, firstName: personName })
    );
    const { personId } = (await created.json()) as { personId: string };

    const contactResponse = await createContact(
      post(`https://kincall.test/api/people/${personId}/contacts`, {
        firstName: contactName,
        phone: "+33655555555",
        relationship: "friend",
        consentStatus: "confirmed",
      }),
      { params: Promise.resolve({ id: personId }) }
    );
    const { contactId } = (await contactResponse.json()) as { contactId: string };
    return { personId, contactId };
  }

  it("archives a contact with no active call", async () => {
    const { personId, contactId } = await freshPersonWithContact("Host1", "Ana");

    const response = await deleteContact(
      del(`https://kincall.test/api/people/${personId}/contacts/${contactId}`),
      params(personId, contactId)
    );

    expect(response.status).toBe(200);
    const contact = (await getRepository().getTrustedContacts(personId)).find(
      (c) => c.id === contactId
    );
    expect(contact?.archivedAt).not.toBeNull();
    // Disappears from the active circle used by ordering and the cascade.
    expect(
      (await getRepository().getActiveTrustedContacts(personId)).map((c) => c.id)
    ).not.toContain(contactId);
  });

  it("404s for an unknown person", async () => {
    const response = await deleteContact(
      del("https://kincall.test/api/people/person_nope/contacts/contact_nope"),
      params("person_nope", "contact_nope")
    );
    expect(response.status).toBe(404);
  });

  it("404s for an unknown contact on a known person", async () => {
    const { personId } = await freshPersonWithContact("Host2", "Ben");

    const response = await deleteContact(
      del(`https://kincall.test/api/people/${personId}/contacts/contact_nope`),
      params(personId, "contact_nope")
    );
    expect(response.status).toBe(404);
  });

  it("refuses with 409 while the contact has an active call, and archives nothing", async () => {
    // The active-call check keys on contact id alone, so the seeded
    // contact_julie (with a real active-call fixture available) is used here
    // deliberately — this is the one scenario in this block that must NOT
    // create a fresh contact, since seedPendingFamilyCallIntent only knows how
    // to attach a call to person_marie's seeded circle.
    await seedPendingFamilyCallIntent(getRepository(), "contact_julie");

    const response = await deleteContact(
      del("https://kincall.test/api/people/person_marie/contacts/contact_julie"),
      params("person_marie", "contact_julie")
    );

    expect(response.status).toBe(409);
    const { error } = (await response.json()) as { error: string };
    expect(error).toMatch(/active call/i);
    const contact = (await getRepository().getTrustedContacts("person_marie")).find(
      (c) => c.id === "contact_julie"
    );
    expect(contact?.archivedAt).toBeNull();
  });

  it("is idempotent: deleting an already-archived contact succeeds again", async () => {
    const { personId, contactId } = await freshPersonWithContact("Host3", "Cleo");
    await deleteContact(
      del(`https://kincall.test/api/people/${personId}/contacts/${contactId}`),
      params(personId, contactId)
    );

    const response = await deleteContact(
      del(`https://kincall.test/api/people/${personId}/contacts/${contactId}`),
      params(personId, contactId)
    );
    expect(response.status).toBe(200);
  });
});
