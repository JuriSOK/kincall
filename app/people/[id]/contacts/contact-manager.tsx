"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FieldErrors } from "@/lib/validation/profile";
import { submitContactForm } from "./contact-form-submit";
import { DeleteContactButton } from "./delete-contact-button";

// Deliberately NOT TrustedContact: the real, unmasked phone must never cross
// into a Client Component's props, since those are serialized into the page
// payload sent to the browser. The server computes `maskedPhone` and this is
// the only phone-shaped thing this component ever sees.
export interface ContactSummary {
  id: string;
  firstName: string;
  relationship: string;
  priority: number;
  maskedPhone: string;
}

interface Props {
  personId: string;
  contacts: ContactSummary[];
  // Precomputed on the server, where CALLE_MODE and the environment live.
  readiness: Record<string, { kind: string; message?: string }>;
}

export function ContactManager({ personId, contacts, readiness }: Props) {
  const router = useRouter();
  const [order, setOrder] = useState(contacts.map((contact) => contact.id));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  // useState's initializer only runs on mount, so without this, adding or
  // deleting a contact and calling router.refresh() would leave `order`
  // holding stale ids — the very set this component is supposed to reflect.
  // Keyed on the joined id list (not the `contacts` array reference) so an
  // unrelated re-render can never reset an in-progress local reorder before
  // the user has clicked "Save order".
  const contactIdsKey = contacts.map((contact) => contact.id).join(",");
  useEffect(() => {
    setOrder(contacts.map((contact) => contact.id));
  }, [contactIdsKey]);

  const byId = new Map(contacts.map((contact) => [contact.id, contact]));
  const dirty = order.some((id, index) => contacts[index]?.id !== id);

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  }

  async function saveOrder() {
    setBusy(true);
    const response = await fetch(`/api/people/${personId}/contacts/order`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: order }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { errors?: FieldErrors };
      setErrors(body.errors ?? { orderedIds: "Could not save the order." });
      // Rejected whole — put the list back exactly as it was, so the screen
      // never shows an order the cascade will not follow.
      setOrder(contacts.map((contact) => contact.id));
      setBusy(false);
      return;
    }

    setErrors({});
    setBusy(false);
    router.refresh();
  }

  async function addContact(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    // Captured BEFORE any await: a SyntheticEvent's currentTarget can already
    // be null by the time an async handler resumes, so this reference — not
    // the event — is what must be used for both reading and resetting the form.
    const form = formEvent.currentTarget;
    const data = new FormData(form);
    const fieldValues = {
      firstName: String(data.get("firstName") ?? ""),
      phone: String(data.get("phone") ?? ""),
      relationship: String(data.get("relationship") ?? ""),
      consentStatus: data.get("consent") === "on" ? "confirmed" : "pending",
    };

    setBusy(true);
    // fetchImpl is intentionally omitted: submitContactForm's own default
    // safely wraps the global fetch. Passing the bare `fetch` reference here
    // directly is exactly the "Illegal invocation" bug this must never repeat
    // — browsers require native fetch to be called with the global object as
    // `this`, and handing the reference to another module detaches it.
    const result = await submitContactForm(form, fieldValues, { personId });
    setBusy(false);

    if (!result.ok) {
      // The form is deliberately not reset here: the entered values stay in
      // the (uncontrolled) inputs exactly as the user left them.
      setErrors(result.errors);
      return;
    }

    setErrors({});
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
          Cascade order
        </h2>
        <p className="text-sm opacity-70">
          KinCall calls the circle in this order and stops as soon as someone confirms.
        </p>

        {order.length === 0 ? (
          <p className="rounded-md border border-black/10 px-4 py-3 text-sm opacity-70 dark:border-white/10">
            No trusted contacts yet. Add one below.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {order.map((id, index) => {
              const contact = byId.get(id);
              if (!contact) return null;
              const state = readiness[id];
              return (
                <li
                  key={id}
                  className="flex items-center gap-3 rounded-md border border-black/10 px-4 py-3 dark:border-white/10"
                >
                  <span className="w-6 text-sm opacity-60">{index + 1}.</span>
                  <span className="flex-1">
                    {contact.firstName} — {contact.relationship}
                    <span className="ml-2 font-mono text-xs opacity-50">{contact.maskedPhone}</span>
                    {state && state.kind !== "ready" && state.kind !== "fake_mode" ? (
                      <span className="block text-xs text-amber-700 dark:text-amber-400">
                        {state.message}
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0 || busy}
                    aria-label={`Move ${contact.firstName} earlier`}
                    className="rounded border border-black/20 px-2 py-1 text-xs disabled:opacity-30 dark:border-white/20"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === order.length - 1 || busy}
                    aria-label={`Move ${contact.firstName} later`}
                    className="rounded border border-black/20 px-2 py-1 text-xs disabled:opacity-30 dark:border-white/20"
                  >
                    ↓
                  </button>
                  <DeleteContactButton
                    personId={personId}
                    contactId={contact.id}
                    contactName={contact.firstName}
                  />
                </li>
              );
            })}
          </ol>
        )}

        {errors.orderedIds ? (
          <p className="text-xs text-red-600 dark:text-red-400">{errors.orderedIds}</p>
        ) : null}

        {dirty ? (
          <button
            type="button"
            onClick={saveOrder}
            disabled={busy}
            className="w-fit rounded-md border border-black/20 px-4 py-2 text-sm hover:border-black/40 disabled:opacity-50 dark:border-white/20"
          >
            {busy ? "Saving…" : "Save order"}
          </button>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">Add a contact</h2>
        <form onSubmit={addContact} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">First name</span>
            <input
              name="firstName"
              required
              maxLength={50}
              className="w-full rounded-md border border-black/20 px-3 py-2 dark:border-white/20 dark:bg-transparent"
            />
            {errors.firstName ? (
              <span className="text-xs text-red-600 dark:text-red-400">{errors.firstName}</span>
            ) : null}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Phone (E.164)</span>
            <input
              name="phone"
              type="tel"
              required
              placeholder="+33612345678"
              className="w-full rounded-md border border-black/20 px-3 py-2 font-mono dark:border-white/20 dark:bg-transparent"
            />
            {errors.phone ? (
              <span className="text-xs text-red-600 dark:text-red-400">{errors.phone}</span>
            ) : (
              <span className="text-xs opacity-60">
                Stored on the server, masked wherever it is shown. An environment-variable
                override can still redirect this contact&apos;s live number if one is set.
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Relationship</span>
            <input
              name="relationship"
              required
              maxLength={40}
              placeholder="daughter, son, trusted neighbour"
              className="w-full rounded-md border border-black/20 px-3 py-2 dark:border-white/20 dark:bg-transparent"
            />
            {errors.relationship ? (
              <span className="text-xs text-red-600 dark:text-red-400">{errors.relationship}</span>
            ) : null}
          </label>

          <label className="flex items-start gap-3 text-sm">
            <input name="consent" type="checkbox" className="mt-1" />
            <span>
              They have agreed to be called by KinCall on this person&apos;s behalf.
              <span className="block opacity-70">
                Without this, the contact is saved but is skipped by the cascade.
              </span>
            </span>
          </label>

          <button
            type="submit"
            disabled={busy}
            className="w-fit rounded-md border border-black/20 px-4 py-2 text-sm hover:border-black/40 disabled:opacity-50 dark:border-white/20"
          >
            Add contact
          </button>
        </form>
      </section>
    </div>
  );
}
