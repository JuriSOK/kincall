import { beforeEach, describe, expect, it } from "vitest";
import { POST as createPerson } from "@/app/api/people/route";
import { POST as createContact } from "@/app/api/people/[id]/contacts/route";
import { PATCH as reorderContacts } from "@/app/api/people/[id]/contacts/order/route";
import { getRepository } from "@/lib/database/store";

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
