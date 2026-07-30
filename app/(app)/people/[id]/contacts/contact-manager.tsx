"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FieldErrors } from "@/lib/validation/profile";
import { Button } from "@/app/ui/button";
import { controlClasses, FormField } from "@/app/ui/form-field";
import { Card, EmptyState, Notice } from "@/app/ui/surfaces";
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
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Announced politely so a keyboard or screen-reader user gets confirmation
  // that a move or a save actually took effect — otherwise reordering is
  // silent and there is no way to tell.
  const [announcement, setAnnouncement] = useState("");

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
    const moved = byId.get(next[target]);
    if (moved) {
      setAnnouncement(`${moved.firstName} moved to position ${target + 1} of ${next.length}. Not saved yet.`);
    }
  }

  async function saveOrder() {
    setBusy(true);
    setFormError(null);

    try {
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
        return;
      }

      setErrors({});
      setAnnouncement("Cascade order saved.");
      router.refresh();
    } catch {
      // Same reasoning as the rejection path: the saved order is unknown, so
      // the displayed order must go back to the last known-good one rather
      // than keep showing an order the cascade may not follow.
      setOrder(contacts.map((contact) => contact.id));
      setFormError("Could not reach the server. The order was not saved.");
    } finally {
      setBusy(false);
    }
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
    setFormError(null);

    try {
      // fetchImpl is intentionally omitted: submitContactForm's own default
      // safely wraps the global fetch. Passing the bare `fetch` reference here
      // directly is exactly the "Illegal invocation" bug this must never repeat
      // — browsers require native fetch to be called with the global object as
      // `this`, and handing the reference to another module detaches it.
      const result = await submitContactForm(form, fieldValues, { personId });

      if (!result.ok) {
        // The form is deliberately not reset here: the entered values stay in
        // the (uncontrolled) inputs exactly as the user left them.
        setErrors(result.errors);
        if (result.networkError) setFormError(result.networkError);
        return;
      }

      setErrors({});
      setAnnouncement("Contact added.");
      router.refresh();
    } catch {
      // submitContactForm reports a failed request rather than throwing, so
      // this is the belt-and-braces case: anything unexpected still releases
      // the button instead of disabling it for the rest of the session.
      setFormError("Could not add this contact. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <Card
        title="Cascade order"
        description="KinCall calls the circle in this order and stops as soon as someone confirms."
        actions={
          dirty ? (
            <Button onClick={saveOrder} disabled={busy} size="sm">
              {busy ? "Saving…" : "Save order"}
            </Button>
          ) : null
        }
      >
        {order.length === 0 ? (
          <EmptyState title="No trusted contacts yet">
            Add the first person KinCall should call when a check-in needs attention.
          </EmptyState>
        ) : (
          <ol className="flex flex-col gap-2">
            {order.map((id, index) => {
              const contact = byId.get(id);
              if (!contact) return null;
              const state = readiness[id];
              return (
                <li
                  key={id}
                  className="flex flex-wrap items-center gap-3 rounded-kc border border-line bg-sunken px-4 py-3"
                >
                  <span className="w-6 text-sm text-subtle">{index + 1}.</span>
                  <span className="min-w-48 flex-1">
                    <span className="text-sm font-medium">{contact.firstName}</span>
                    <span className="text-sm text-muted"> — {contact.relationship}</span>
                    <span className="ml-2 font-mono text-xs text-subtle">{contact.maskedPhone}</span>
                    {state && state.kind !== "ready" && state.kind !== "fake_mode" ? (
                      <span className="mt-1 block text-xs text-attention-ink">{state.message}</span>
                    ) : null}
                  </span>
                  {/* Kept as the accessible ordering path: plain buttons work
                      with a keyboard and a screen reader without any of the
                      pointer-event handling drag-and-drop needs. */}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => move(index, -1)}
                    disabled={index === 0 || busy}
                    aria-label={`Move ${contact.firstName} earlier`}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => move(index, 1)}
                    disabled={index === order.length - 1 || busy}
                    aria-label={`Move ${contact.firstName} later`}
                  >
                    ↓
                  </Button>
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
          <p role="alert" className="mt-3 text-xs font-medium text-danger">
            {errors.orderedIds}
          </p>
        ) : null}
      </Card>

      <Card title="Add a contact">
        <form onSubmit={addContact} className="flex flex-col gap-4">
          <FormField label="First name" error={errors.firstName}>
            {(field) => (
              <input {...field} name="firstName" required maxLength={50} className={controlClasses} />
            )}
          </FormField>

          <FormField
            label="Phone (E.164)"
            error={errors.phone}
            hint="Stored on the server, masked wherever it is shown. An environment-variable override can still redirect this contact's live number if one is set."
          >
            {(field) => (
              <input
                {...field}
                name="phone"
                type="tel"
                required
                placeholder="+33612345678"
                className={`${controlClasses} font-mono`}
              />
            )}
          </FormField>

          <FormField label="Relationship" error={errors.relationship}>
            {(field) => (
              <input
                {...field}
                name="relationship"
                required
                maxLength={40}
                placeholder="daughter, son, trusted neighbour"
                className={controlClasses}
              />
            )}
          </FormField>

          <label className="flex items-start gap-3 rounded-kc border border-line bg-sunken p-4 text-sm">
            <input name="consent" type="checkbox" className="mt-1 accent-accent" />
            <span>
              <span className="font-medium">
                They have agreed to be called by KinCall on this person&apos;s behalf.
              </span>
              <span className="mt-1 block text-muted">
                Without this, the contact is saved but is skipped by the cascade.
              </span>
            </span>
          </label>

          {formError ? <Notice tone="danger">{formError}</Notice> : null}

          <Button type="submit" disabled={busy} className="w-fit">
            {busy ? "Adding…" : "Add contact"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
