"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CONVERSATION_PROFILES,
  PREFERRED_LANGUAGES,
  type FieldErrors,
} from "@/lib/validation/profile";
import type { VulnerablePerson } from "@/lib/database/types";
import { Button, ButtonLink } from "@/app/ui/button";
import { controlClasses, FormField } from "@/app/ui/form-field";
import { Notice } from "@/app/ui/surfaces";
import { AvatarPicker } from "@/app/ui/avatars/avatar-picker";
import { WEEKDAYS } from "@/lib/schedule/format-schedule";
import { describeConversationProfile, describeLanguage } from "@/lib/presentation/labels";
import { COMMON_TIMEZONES } from "../../profile-form-constants";
import { submitPersonEdit } from "./person-edit-submit";

export function PersonEditForm({ person }: { person: VulnerablePerson }) {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [checkInDays, setCheckInDays] = useState<number[]>(person.checkInDays);

  function toggleDay(day: number) {
    setCheckInDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort((a, b) => a - b)
    );
  }

  async function onSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);

    const avatarKey = String(form.get("avatarKey") ?? "");
    const payload = {
      avatarKey: avatarKey.length > 0 ? avatarKey : null,
      preferredLanguage: String(form.get("preferredLanguage") ?? ""),
      timezone: String(form.get("timezone") ?? ""),
      preferredCallTime: String(form.get("preferredCallTime") ?? ""),
      checkInDays,
      scheduleState: String(form.get("scheduleState") ?? ""),
      conversationProfile: String(form.get("conversationProfile") ?? ""),
      interests: String(form.get("interests") ?? "")
        .split(",")
        .map((interest) => interest.trim())
        .filter(Boolean),
      conversationNotes: (() => {
        const value = String(form.get("conversationNotes") ?? "").trim();
        return value.length > 0 ? value : null;
      })(),
      consentStatus: form.get("consent") === "on" ? "confirmed" : "pending",
    };

    setSubmitting(true);
    setErrors({});
    setFormError(null);
    setSaved(false);

    let navigating = false;
    try {
      const result = await submitPersonEdit(payload, { personId: person.id });

      if (!result.ok) {
        if (result.networkError) {
          setFormError(result.networkError);
        } else if (Object.keys(result.errors).length > 0) {
          setErrors(result.errors);
        } else {
          setFormError("Could not save these changes. Please try again.");
        }
        return;
      }

      // A clear success state, then a route back to the person page — see
      // the Stage-C brief's own requirement that both exist rather than only
      // one. The short pause is deliberate: a save that instantly redirects
      // reads as if nothing happened.
      setSaved(true);
      navigating = true;
      router.push(`/people/${person.id}`);
      router.refresh();
    } finally {
      if (!navigating) setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">Identity</h2>
        <AvatarPicker defaultValue={person.avatarKey} />

        <FormField label="Language" error={errors.preferredLanguage}>
          {(field) => (
            <select
              {...field}
              name="preferredLanguage"
              defaultValue={person.preferredLanguage}
              className={controlClasses}
            >
              {PREFERRED_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {describeLanguage(language)}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">
          Check-in preferences
        </h2>

        <FormField label="Timezone" error={errors.timezone}>
          {(field) => (
            <select {...field} name="timezone" defaultValue={person.timezone} className={controlClasses}>
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
            <input
              {...field}
              name="preferredCallTime"
              type="time"
              defaultValue={person.preferredCallTime}
              className={controlClasses}
            />
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
            <select
              {...field}
              name="scheduleState"
              defaultValue={person.scheduleState}
              className={controlClasses}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="inactive">Inactive</option>
            </select>
          )}
        </FormField>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">
          Conversation preferences
        </h2>

        <FormField label="Conversation profile" error={errors.conversationProfile}>
          {(field) => (
            <select
              {...field}
              name="conversationProfile"
              defaultValue={person.conversationProfile}
              className={controlClasses}
            >
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
            <input
              {...field}
              name="interests"
              defaultValue={person.interests.join(", ")}
              placeholder="gardening, family"
              className={controlClasses}
            />
          )}
        </FormField>

        <FormField
          label="Conversation notes"
          error={errors.conversationNotes}
          hint="Ordinary habits or preferences only — never a phone number, a medical detail, or an emergency instruction. Up to 280 characters."
        >
          {(field) => (
            <textarea
              {...field}
              name="conversationNotes"
              defaultValue={person.conversationNotes ?? ""}
              maxLength={280}
              rows={3}
              className={controlClasses}
            />
          )}
        </FormField>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">Consent</h2>
        <label className="flex items-start gap-3 rounded-kc border border-line bg-sunken p-4 text-sm">
          <input
            name="consent"
            type="checkbox"
            defaultChecked={person.consentStatus === "confirmed"}
            className="mt-1 accent-accent"
          />
          <span>
            <span className="font-medium">They have agreed to be called.</span>
            <span className="mt-1 block text-muted">
              Without this, the profile is kept but no check-in can be launched.
            </span>
          </span>
        </label>
      </section>

      {formError ? <Notice tone="danger">{formError}</Notice> : null}
      {saved ? <Notice tone="calm">Saved.</Notice> : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save changes"}
        </Button>
        <ButtonLink href={`/people/${person.id}`} variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
