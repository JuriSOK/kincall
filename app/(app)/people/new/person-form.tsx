"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CONVERSATION_PROFILES,
  PREFERRED_LANGUAGES,
  validatePersonInput,
  type FieldErrors,
} from "@/lib/validation/profile";
import { Button } from "@/app/ui/button";
import { controlClasses, FormField } from "@/app/ui/form-field";
import { Notice } from "@/app/ui/surfaces";
import { AvatarPicker } from "@/app/ui/avatars/avatar-picker";
import { WEEKDAYS } from "@/lib/schedule/format-schedule";
import { describeConversationProfile, describeLanguage } from "@/lib/presentation/labels";
import { COMMON_TIMEZONES } from "../profile-form-constants";

export function PersonForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  // A failure that belongs to no single field: the request never reached the
  // server, or its response could not be read. Kept separate from `errors` so
  // a network problem is not reported as if the user mistyped a name.
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkInDays, setCheckInDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);

  function toggleDay(day: number) {
    setCheckInDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort((a, b) => a - b)
    );
  }

  async function onSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);

    const avatarKey = String(form.get("avatarKey") ?? "");
    const conversationNotes = String(form.get("conversationNotes") ?? "").trim();

    const payload = {
      firstName: String(form.get("firstName") ?? ""),
      phone: String(form.get("phone") ?? ""),
      avatarKey: avatarKey.length > 0 ? avatarKey : null,
      preferredLanguage: String(form.get("preferredLanguage") ?? ""),
      timezone: String(form.get("timezone") ?? ""),
      conversationProfile: String(form.get("conversationProfile") ?? ""),
      preferredCallTime: String(form.get("preferredCallTime") ?? ""),
      checkInDays,
      scheduleState: String(form.get("scheduleState") ?? ""),
      interests: String(form.get("interests") ?? "")
        .split(",")
        .map((interest) => interest.trim())
        .filter(Boolean),
      conversationNotes: conversationNotes.length > 0 ? conversationNotes : null,
      // Unticked means "pending", which blocks calling entirely (§17.1).
      consentStatus: form.get("consent") === "on" ? "confirmed" : "pending",
    };

    // Same validator the route handler runs, so the user sees every problem
    // before a round trip — the server still re-validates.
    const local = validatePersonInput(payload);
    if (!local.values) {
      setErrors(local.errors);
      return;
    }

    setSubmitting(true);
    setErrors({});
    setFormError(null);

    // `navigating` rather than an unconditional `finally { setSubmitting(false) }`:
    // on success we leave the button disabled while the route transition runs,
    // so it cannot be clicked twice. Every other exit — including a thrown
    // fetch, which is what left this button disabled forever before — must
    // release it.
    let navigating = false;
    try {
      const response = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { errors?: FieldErrors };
        if (body.errors) {
          setErrors(body.errors);
        } else {
          setFormError("Could not create this profile. Please try again.");
        }
        return;
      }

      // Guarded like the failure path: a 200 whose body is not the JSON we
      // expect must not throw out of the handler.
      const body = (await response.json().catch(() => null)) as { personId?: string } | null;
      if (!body?.personId) {
        setFormError("The profile may have been created, but the response could not be read. Reload this page to check.");
        return;
      }

      navigating = true;
      router.push(`/people/${body.personId}`);
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      if (!navigating) setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <section className="flex flex-col gap-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">Identity</h2>

        <AvatarPicker />

        <FormField label="First name" error={errors.firstName}>
          {(field) => <input {...field} name="firstName" required maxLength={50} className={controlClasses} />}
        </FormField>

        <FormField label="Phone (E.164)" error={errors.phone}>
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

        <FormField label="Language" error={errors.preferredLanguage}>
          {(field) => (
            <select {...field} name="preferredLanguage" defaultValue="fr-FR" className={controlClasses}>
              {PREFERRED_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {describeLanguage(language)}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </section>

      <section className="flex flex-col gap-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">
          Check-in preferences
        </h2>

        <FormField label="Timezone" error={errors.timezone}>
          {(field) => (
            <select {...field} name="timezone" defaultValue="Europe/Paris" className={controlClasses}>
              {COMMON_TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField label="Preferred check-in time" error={errors.preferredCallTime}>
          {(field) => (
            <input {...field} name="preferredCallTime" type="time" defaultValue="09:00" className={controlClasses} />
          )}
        </FormField>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Days</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => (
              <label
                key={day.value}
                className="flex cursor-pointer items-center gap-1.5 rounded-kc-sm border border-line px-2.5 py-1.5 text-xs has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
              >
                <input
                  type="checkbox"
                  checked={checkInDays.includes(day.value)}
                  onChange={() => toggleDay(day.value)}
                  className="sr-only"
                />
                {day.label}
              </label>
            ))}
          </div>
          {errors.checkInDays ? (
            <p role="alert" className="text-xs font-medium text-danger">
              {errors.checkInDays}
            </p>
          ) : null}
        </fieldset>

        <FormField label="Schedule state" error={errors.scheduleState}>
          {(field) => (
            <select {...field} name="scheduleState" defaultValue="active" className={controlClasses}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="inactive">Inactive</option>
            </select>
          )}
        </FormField>
      </section>

      <section className="flex flex-col gap-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">
          Conversation preferences
        </h2>

        <FormField label="Conversation profile" error={errors.conversationProfile}>
          {(field) => (
            <select {...field} name="conversationProfile" defaultValue="standard" className={controlClasses}>
              {CONVERSATION_PROFILES.map((profile) => (
                <option key={profile} value={profile}>
                  {describeConversationProfile(profile)}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField
          label="Interests (comma separated)"
          error={errors.interests}
          hint="Mentioned by the Companion Agent to open the conversation naturally."
        >
          {(field) => (
            <input {...field} name="interests" placeholder="gardening, family" className={controlClasses} />
          )}
        </FormField>

        <FormField
          label="Conversation notes"
          error={errors.conversationNotes}
          hint="Ordinary habits or preferences only — never a phone number, a medical detail, or an emergency instruction. Up to 280 characters."
        >
          {(field) => (
            <textarea {...field} name="conversationNotes" maxLength={280} rows={3} className={controlClasses} />
          )}
        </FormField>
      </section>

      <section className="flex flex-col gap-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">Consent</h2>

        <label className="flex items-start gap-3 rounded-kc border border-line bg-sunken p-4 text-sm">
          <input name="consent" type="checkbox" className="mt-1 accent-accent" />
          <span>
            <span className="font-medium">They have agreed to be called.</span>
            <span className="mt-1 block text-muted">
              KinCall only calls people who have accepted automated calls, conversation analysis,
              and sharing the necessary facts with their trusted circle. Without this, the profile
              is saved but no check-in can be launched.
            </span>
          </span>
        </label>
      </section>

      {formError ? <Notice tone="danger">{formError}</Notice> : null}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create profile"}
      </Button>
    </form>
  );
}
