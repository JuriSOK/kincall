"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { ConsentStatus } from "@/lib/database/types";
import type { MeanMetric, RateMetric } from "@/lib/kpi/dashboard-kpis";
import type { FieldErrors } from "@/lib/validation/profile";
import { Button } from "@/app/ui/button";
import { controlClasses, FormField } from "@/app/ui/form-field";
import { Badge, Card, EmptyState, Notice } from "@/app/ui/surfaces";
import { COMMON_TIMEZONES } from "../../profile-form-constants";
import { submitContactEdit } from "./contact-edit-submit";
import { submitContactForm } from "./contact-form-submit";
import { submitContactToggle } from "./contact-toggle-submit";
import { submitMakePrimary } from "./contact-primary-submit";
import { DeleteContactButton } from "./delete-contact-button";

// Deliberately NOT TrustedContact: the real, unmasked phone must never cross
// into a Client Component's props, since those are serialized into the page
// payload sent to the browser. The server computes `maskedPhone` and
// pre-formatted stats; this is the only phone-shaped thing this component
// ever sees.
export interface ContactStatsSummary {
  answerRate: RateMetric;
  acceptanceRate: RateMetric;
  declineRate: RateMetric;
  meanAttemptWhenAnswering: MeanMetric;
  latestParticipationLabel: string | null;
  confirmedInterventions: number;
}

export interface ContactSummary {
  id: string;
  firstName: string;
  relationship: string;
  priority: number;
  maskedPhone: string;
  consentStatus: ConsentStatus;
  isPrimary: boolean;
  enabled: boolean;
  callableFrom: string | null;
  callableTo: string | null;
  timezone: string | null;
  maxAttempts: number;
  stats: ContactStatsSummary;
}

interface Props {
  personId: string;
  personTimezone: string;
  contacts: ContactSummary[];
  // Precomputed on the server, where CALLE_MODE and the environment live.
  readiness: Record<string, { kind: string; message?: string }>;
}

function formatRate(rate: RateMetric): string {
  return rate.total === 0 ? "Not enough data" : `${rate.count}/${rate.total} (${rate.percentage}%)`;
}

// Never the raw HH:MM pair without context, and never claims a window
// excludes anyone — see this page's own lead text for the "orders, never
// excludes" guarantee.
function formatWindow(from: string | null, to: string | null): string {
  return from === null || to === null ? "Always available" : `${from}–${to}`;
}

export function ContactManager({ personId, personTimezone, contacts, readiness }: Props) {
  const router = useRouter();
  const [order, setOrder] = useState(contacts.map((contact) => contact.id));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Announced politely so a keyboard or screen-reader user gets confirmation
  // that a move or a save actually took effect.
  const [announcement, setAnnouncement] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  // Keyboard reorder mode: the id currently "lifted", or null.
  const [liftedId, setLiftedId] = useState<string | null>(null);
  const [pointerDraggingId, setPointerDraggingId] = useState<string | null>(null);

  const liftedOriginalOrderRef = useRef<string[] | null>(null);
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  // useState's initializer only runs on mount, so without this, adding or
  // deleting a contact and calling router.refresh() would leave `order`
  // holding stale ids.
  const contactIdsKey = contacts.map((contact) => contact.id).join(",");
  useEffect(() => {
    setOrder(contacts.map((contact) => contact.id));
  }, [contactIdsKey]);

  const byId = new Map(contacts.map((contact) => [contact.id, contact]));
  const dirty = order.some((id, index) => contacts[index]?.id !== id);

  function moveId(id: string, direction: -1 | 1) {
    setOrder((current) => {
      const index = current.indexOf(id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  // Shared by the ↑/↓ buttons AND the keyboard arrow-key path — one
  // implementation of "move and announce", so the two can never drift apart.
  // The announced position is computed from the PRE-move order, since
  // setOrder's update has not yet applied when this runs.
  function arrowMove(id: string, direction: -1 | 1) {
    const currentIndex = order.indexOf(id);
    const targetIndex = currentIndex + direction;
    if (currentIndex === -1 || targetIndex < 0 || targetIndex >= order.length) return;
    moveId(id, direction);
    const contact = byId.get(id);
    if (contact) {
      setAnnouncement(
        `${contact.firstName} moved to position ${targetIndex + 1} of ${order.length}. Not saved yet.`
      );
    }
  }

  // ── Keyboard drag-and-drop: Space to lift, arrows to move, Enter to drop,
  //    Escape to cancel (retained ↑/↓ buttons are the accessible fallback,
  //    always present, never removed). ──
  function handleHandleKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    const contact = byId.get(id);
    if (!contact || busy) return;

    if (liftedId !== id) {
      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        liftedOriginalOrderRef.current = order;
        setLiftedId(id);
        setAnnouncement(
          `${contact.firstName} lifted, position ${order.indexOf(id) + 1} of ${order.length}. Use arrow keys to move, Enter to drop, Escape to cancel.`
        );
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      arrowMove(id, -1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      arrowMove(id, 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const position = order.indexOf(id) + 1;
      setLiftedId(null);
      liftedOriginalOrderRef.current = null;
      setAnnouncement(`${contact.firstName} dropped at position ${position} of ${order.length}. Not saved yet.`);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (liftedOriginalOrderRef.current) setOrder(liftedOriginalOrderRef.current);
      setLiftedId(null);
      liftedOriginalOrderRef.current = null;
      setAnnouncement("Reorder cancelled.");
    }
  }

  // ── Pointer-based drag-and-drop: Pointer Events cover mouse, touch and pen
  //    in one API, unlike native HTML5 drag-and-drop, which does not reliably
  //    support touch — this is why pointer events were chosen over that, with
  //    no drag library added. ──
  function handlePointerDown(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (liftedId || busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPointerDraggingId(id);
  }

  function handlePointerMove(event: PointerEvent<HTMLOListElement>) {
    if (!pointerDraggingId) return;
    const clientY = event.clientY;
    let targetId: string | null = null;
    for (const id of order) {
      const el = rowRefs.current.get(id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        targetId = id;
        break;
      }
    }
    if (targetId && targetId !== pointerDraggingId) {
      setOrder((current) => {
        const from = current.indexOf(pointerDraggingId);
        const to = current.indexOf(targetId!);
        if (from === -1 || to === -1) return current;
        const next = [...current];
        next.splice(from, 1);
        next.splice(to, 0, pointerDraggingId);
        return next;
      });
    }
  }

  function endPointerDrag() {
    if (!pointerDraggingId) return;
    const contact = byId.get(pointerDraggingId);
    if (contact) {
      const position = order.indexOf(pointerDraggingId) + 1;
      setAnnouncement(`${contact.firstName} moved to position ${position} of ${order.length}. Not saved yet.`);
    }
    setPointerDraggingId(null);
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
        setOrder(contacts.map((contact) => contact.id));
        return;
      }

      setErrors({});
      setAnnouncement("Cascade order saved.");
      router.refresh();
    } catch {
      setOrder(contacts.map((contact) => contact.id));
      setFormError("Could not reach the server. The order was not saved.");
    } finally {
      setBusy(false);
    }
  }

  async function addContact(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
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
      const result = await submitContactForm(form, fieldValues, { personId });

      if (!result.ok) {
        setErrors(result.errors);
        if (result.networkError) setFormError(result.networkError);
        return;
      }

      setErrors({});
      setAnnouncement("Contact added.");
      router.refresh();
    } catch {
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
        description="KinCall calls the circle in this order and stops as soon as someone confirms. Availability only reorders who is tried first — see the guarantee above."
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
          <ol
            className="flex flex-col gap-3"
            onPointerMove={handlePointerMove}
            onPointerUp={endPointerDrag}
            onPointerCancel={endPointerDrag}
          >
            {order.map((id, index) => {
              const contact = byId.get(id);
              if (!contact) return null;
              const state = readiness[id];
              const isLifted = liftedId === id;
              const isDragging = pointerDraggingId === id;

              return (
                <li
                  key={id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(id, el);
                    else rowRefs.current.delete(id);
                  }}
                  className={`flex flex-col gap-2 rounded-kc border px-4 py-3 transition-colors ${
                    isLifted || isDragging
                      ? "border-accent bg-accent-soft"
                      : "border-line bg-sunken"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onPointerDown={(event) => handlePointerDown(event, id)}
                      onKeyDown={(event) => handleHandleKeyDown(event, id)}
                      aria-pressed={isLifted}
                      aria-label={`Reorder ${contact.firstName}, position ${index + 1} of ${order.length}. Press Space to lift, arrow keys to move, Enter to drop, Escape to cancel.`}
                      disabled={busy}
                      style={{ touchAction: "none" }}
                      className="cursor-grab select-none rounded-kc-sm border border-line bg-surface px-2 py-1.5 text-sm text-muted hover:border-line-strong active:cursor-grabbing aria-pressed:border-accent aria-pressed:text-accent"
                    >
                      ⠿
                    </button>
                    <span className="w-6 text-sm text-subtle">{index + 1}.</span>
                    <span className="min-w-48 flex-1">
                      <span className="text-sm font-medium">{contact.firstName}</span>
                      {contact.isPrimary ? (
                        <span className="ml-2">
                          <Badge tone="calm">Primary</Badge>
                        </span>
                      ) : null}
                      <span className="text-sm text-muted"> — {contact.relationship}</span>
                      <span className="ml-2 font-mono text-xs text-subtle">{contact.maskedPhone}</span>
                    </span>
                    <Badge tone={contact.consentStatus === "confirmed" ? "calm" : "attention"}>
                      Consent: {contact.consentStatus}
                    </Badge>
                    <Badge tone={contact.enabled ? "calm" : "neutral"}>
                      {contact.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                    {state && state.kind !== "ready" && state.kind !== "fake_mode" ? (
                      <span className="text-xs text-attention-ink">{state.message}</span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
                    <span>Callable window: {formatWindow(contact.callableFrom, contact.callableTo)}</span>
                    <span>Timezone: {contact.timezone ?? `Inherits ${personTimezone}`}</span>
                    <span>Maximum attempts: {contact.maxAttempts}</span>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
                    <span>Answered: {formatRate(contact.stats.answerRate)}</span>
                    <span>Accepted (of answered): {formatRate(contact.stats.acceptanceRate)}</span>
                    <span>Declined (of answered): {formatRate(contact.stats.declineRate)}</span>
                    <span>
                      Mean attempt when answering:{" "}
                      {contact.stats.meanAttemptWhenAnswering.mean === null
                        ? "Not enough data"
                        : contact.stats.meanAttemptWhenAnswering.mean.toFixed(1)}
                    </span>
                    <span>Confirmed interventions: {contact.stats.confirmedInterventions}</span>
                    <span>Last participation: {contact.stats.latestParticipationLabel ?? "Never"}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => arrowMove(id, -1)}
                      disabled={index === 0 || busy}
                      aria-label={`Move ${contact.firstName} earlier`}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => arrowMove(id, 1)}
                      disabled={index === order.length - 1 || busy}
                      aria-label={`Move ${contact.firstName} later`}
                    >
                      ↓
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditingId(editingId === id ? null : id)}
                      disabled={busy}
                    >
                      {editingId === id ? "Close" : "Edit"}
                    </Button>
                    {!contact.isPrimary ? (
                      <MakePrimaryButton personId={personId} contact={contact} />
                    ) : null}
                    <ContactEnabledToggle personId={personId} contact={contact} />
                    <DeleteContactButton
                      personId={personId}
                      contactId={contact.id}
                      contactName={contact.firstName}
                    />
                  </div>

                  {editingId === id ? (
                    <ContactEditPanel
                      personId={personId}
                      personTimezone={personTimezone}
                      contact={contact}
                      onClose={() => setEditingId(null)}
                    />
                  ) : null}
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
        {formError ? (
          <div className="mt-3">
            <Notice tone="danger" assertive>
              {formError}
            </Notice>
          </div>
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
                Without this, the contact is saved but is skipped by the cascade. New contacts start
                enabled, with no availability restriction and the default maximum of two attempts —
                edit them afterward to change any of that.
              </span>
            </span>
          </label>

          <Button type="submit" disabled={busy} className="w-fit">
            {busy ? "Adding…" : "Add contact"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

function MakePrimaryButton({ personId, contact }: { personId: string; contact: ContactSummary }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitMakePrimary({ personId, contactId: contact.id });
      if (!result.ok) {
        setError(
          result.networkError ??
            Object.values(result.errors)[0] ??
            "Could not set this contact primary."
        );
        return;
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={handleClick}
        disabled={submitting}
        aria-label={`Make ${contact.firstName} the primary contact`}
      >
        {submitting ? "Saving…" : "Make primary"}
      </Button>
      {error ? (
        <Notice tone="danger" assertive>
          {error}
        </Notice>
      ) : null}
    </span>
  );
}

// Enabled/disabled is a reversible exclusion from new cascades, distinct from
// archived (permanent) and from unconsented (a different reason entirely) —
// each state gets its own wording, never blended (Stage E brief §8). No
// optimistic flip: the label only changes once the server confirms.
function ContactEnabledToggle({ personId, contact }: { personId: string; contact: ContactSummary }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextEnabled = !contact.enabled;
  const label = contact.enabled ? "Disable" : "Enable";

  async function handleClick() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitContactToggle(nextEnabled, { personId, contactId: contact.id });
      if (!result.ok) {
        setError(
          result.networkError ??
            Object.values(result.errors)[0] ??
            "Could not update this contact."
        );
        return;
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={handleClick}
        disabled={submitting}
        aria-label={`${label} ${contact.firstName} for the cascade`}
      >
        {submitting ? "Saving…" : label}
      </Button>
      {error ? (
        <Notice tone="danger" assertive>
          {error}
        </Notice>
      ) : null}
    </span>
  );
}

// The full edit panel for relationship, callable window, timezone and
// maximum attempts. `enabled` and `isPrimary` are deliberately absent here —
// each has its own dedicated, single-purpose control above, matching Stage
// D's established pattern of never letting a broad edit form silently change
// a value a lightweight, single-purpose toggle also controls.
function ContactEditPanel({
  personId,
  personTimezone,
  contact,
  onClose,
}: {
  personId: string;
  personTimezone: string;
  contact: ContactSummary;
  onClose: () => void;
}) {
  const router = useRouter();
  const [relationship, setRelationship] = useState(contact.relationship);
  const [hasWindow, setHasWindow] = useState(contact.callableFrom !== null);
  const [callableFrom, setCallableFrom] = useState(contact.callableFrom ?? "09:00");
  const [callableTo, setCallableTo] = useState(contact.callableTo ?? "18:00");
  const [timezone, setTimezone] = useState(contact.timezone ?? "");
  const [maxAttempts, setMaxAttempts] = useState(contact.maxAttempts);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    setFormError(null);

    try {
      const result = await submitContactEdit(
        {
          relationship,
          enabled: contact.enabled,
          callableFrom: hasWindow ? callableFrom : null,
          callableTo: hasWindow ? callableTo : null,
          timezone: timezone === "" ? null : timezone,
          maxAttempts,
        },
        { personId, contactId: contact.id }
      );

      if (!result.ok) {
        if (result.networkError) setFormError(result.networkError);
        else setErrors(result.errors);
        return;
      }

      router.refresh();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 flex flex-col gap-4 rounded-kc border border-line bg-surface p-4"
    >
      <FormField label="Relationship" error={errors.relationship}>
        {(field) => (
          <input
            {...field}
            value={relationship}
            onChange={(event) => setRelationship(event.target.value)}
            maxLength={40}
            className={controlClasses}
          />
        )}
      </FormField>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!hasWindow}
          onChange={(event) => setHasWindow(!event.target.checked)}
          className="accent-accent"
        />
        Always available (no usual callable window)
      </label>

      {hasWindow ? (
        <div className="flex flex-wrap gap-4">
          <FormField label="Callable from" error={errors.callableFrom}>
            {(field) => (
              <input
                {...field}
                type="time"
                value={callableFrom}
                onChange={(event) => setCallableFrom(event.target.value)}
                className={controlClasses}
              />
            )}
          </FormField>
          <FormField label="Callable to" error={errors.callableTo}>
            {(field) => (
              <input
                {...field}
                type="time"
                value={callableTo}
                onChange={(event) => setCallableTo(event.target.value)}
                className={controlClasses}
              />
            )}
          </FormField>
          <p className="w-full text-xs text-subtle">
            An end time earlier than the start (e.g. 22:00–07:00) means overnight, crossing midnight.
            This only decides who is tried FIRST — nobody is ever excluded for being outside it, and
            the cascade never waits for it to open.
          </p>
        </div>
      ) : null}

      <FormField label="Timezone" error={errors.timezone} hint={`Leave as "Inherit" to use ${personTimezone}, the same zone this person's own schedule uses.`}>
        {(field) => (
          <select
            {...field}
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className={controlClasses}
          >
            <option value="">Inherit from person ({personTimezone})</option>
            {COMMON_TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        )}
      </FormField>

      <FormField
        label="Maximum attempts"
        error={errors.maxAttempts}
        hint="Never more than 2 — the platform-wide safety bound. Lower it to 1 to never retry this contact."
      >
        {(field) => (
          <select
            {...field}
            value={maxAttempts}
            onChange={(event) => setMaxAttempts(Number(event.target.value))}
            className={controlClasses}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        )}
      </FormField>

      {formError ? <Notice tone="danger">{formError}</Notice> : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
