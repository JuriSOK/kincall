"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TrustedContact } from "@/lib/database/types";
import { validateContactInput, type FieldErrors } from "@/lib/validation/profile";

interface Props {
  personId: string;
  contacts: TrustedContact[];
  // Precomputed on the server, where CALLE_MODE and the environment live.
  readiness: Record<string, { kind: string; message?: string }>;
}

export function ContactManager({ personId, contacts, readiness }: Props) {
  const router = useRouter();
  const [order, setOrder] = useState(contacts.map((contact) => contact.id));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

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
    const form = new FormData(formEvent.currentTarget);
    const payload = {
      firstName: String(form.get("firstName") ?? ""),
      relationship: String(form.get("relationship") ?? ""),
      consentStatus: form.get("consent") === "on" ? "confirmed" : "pending",
    };

    const local = validateContactInput(payload);
    if (!local.values) {
      setErrors(local.errors);
      return;
    }

    setBusy(true);
    const response = await fetch(`/api/people/${personId}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { errors?: FieldErrors };
      setErrors(body.errors ?? { firstName: "Could not add this contact." });
      setBusy(false);
      return;
    }

    setErrors({});
    setBusy(false);
    formEvent.currentTarget.reset();
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
