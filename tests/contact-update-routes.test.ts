import { describe, expect, it } from "vitest";
import { PATCH as updateContact } from "@/app/api/people/[id]/contacts/[contactId]/route";
import { POST as setPrimary } from "@/app/api/people/[id]/contacts/[contactId]/primary/route";
import { getRepository } from "@/lib/database/store";

function patch(url: string, body: unknown): Request {
  return new Request(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function post(url: string): Request {
  return new Request(url, { method: "POST" });
}

const params = (id: string, contactId: string) => ({ params: Promise.resolve({ id, contactId }) });

describe("PATCH /api/people/[id]/contacts/[contactId]", () => {
  it("updates the supplied fields and persists them", async () => {
    const response = await updateContact(
      patch("https://kincall.test/api/people/person_marie/contacts/contact_julie", {
        relationship: "eldest daughter",
        maxAttempts: 1,
      }),
      params("person_marie", "contact_julie")
    );

    expect(response.status).toBe(200);
    const updated = (await getRepository().getTrustedContacts("person_marie")).find(
      (c) => c.id === "contact_julie"
    );
    expect(updated?.relationship).toBe("eldest daughter");
    expect(updated?.maxAttempts).toBe(1);
  });

  it("rejects an invalid maxAttempts value with a 400 and changes nothing", async () => {
    const before = await getRepository().getTrustedContacts("person_marie");

    const response = await updateContact(
      patch("https://kincall.test/api/people/person_marie/contacts/contact_julie", {
        maxAttempts: 3,
      }),
      params("person_marie", "contact_julie")
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { errors?: Record<string, string> };
    expect(body.errors).toHaveProperty("maxAttempts");
    expect(await getRepository().getTrustedContacts("person_marie")).toEqual(before);
  });

  it("rejects an incomplete callable window", async () => {
    const response = await updateContact(
      patch("https://kincall.test/api/people/person_marie/contacts/contact_julie", {
        callableFrom: "09:00",
      }),
      params("person_marie", "contact_julie")
    );
    expect(response.status).toBe(400);
  });

  it("accepts a cross-midnight callable window", async () => {
    const response = await updateContact(
      patch("https://kincall.test/api/people/person_marie/contacts/contact_julie", {
        callableFrom: "22:00",
        callableTo: "07:00",
      }),
      params("person_marie", "contact_julie")
    );
    expect(response.status).toBe(200);
    const updated = (await getRepository().getTrustedContacts("person_marie")).find(
      (c) => c.id === "contact_julie"
    );
    expect(updated?.callableFrom).toBe("22:00");
    expect(updated?.callableTo).toBe("07:00");
  });

  it("returns 404 for an unknown person", async () => {
    const response = await updateContact(
      patch("https://kincall.test/api/people/person_nope/contacts/contact_julie", { enabled: false }),
      params("person_nope", "contact_julie")
    );
    expect(response.status).toBe(404);
  });

  it("returns 400 with a field error when re-enabling an archived contact", async () => {
    // Nicole, not Julie: this test's archival must not contaminate the
    // primary-contact tests below, which reuse the seeded Julie/Marc.
    await getRepository().archiveTrustedContact("contact_nicole");

    const response = await updateContact(
      patch("https://kincall.test/api/people/person_marie/contacts/contact_nicole", { enabled: true }),
      params("person_marie", "contact_nicole")
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { errors?: Record<string, string> };
    expect(body.errors).toHaveProperty("enabled");
  });
});

describe("POST /api/people/[id]/contacts/[contactId]/primary", () => {
  it("sets the named contact primary and clears the previous one", async () => {
    const first = await setPrimary(
      post("https://kincall.test/api/people/person_marie/contacts/contact_julie/primary"),
      params("person_marie", "contact_julie")
    );
    expect(first.status).toBe(200);

    const second = await setPrimary(
      post("https://kincall.test/api/people/person_marie/contacts/contact_marc/primary"),
      params("person_marie", "contact_marc")
    );
    expect(second.status).toBe(200);

    const circle = await getRepository().getActiveTrustedContacts("person_marie");
    expect(circle.filter((c) => c.isPrimary).map((c) => c.id)).toEqual(["contact_marc"]);
  });

  it("returns 400 when the contact is archived", async () => {
    await getRepository().archiveTrustedContact("contact_julie");

    const response = await setPrimary(
      post("https://kincall.test/api/people/person_marie/contacts/contact_julie/primary"),
      params("person_marie", "contact_julie")
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { errors?: Record<string, string> };
    expect(body.errors).toHaveProperty("makePrimary");
  });

  it("returns 404 for an unknown person", async () => {
    const response = await setPrimary(
      post("https://kincall.test/api/people/person_nope/contacts/contact_julie/primary"),
      params("person_nope", "contact_julie")
    );
    expect(response.status).toBe(404);
  });
});
