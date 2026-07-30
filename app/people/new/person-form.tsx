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

const PROFILE_LABELS: Record<string, string> = {
  standard: "Standard — warm and open-ended",
  cognitive_friendly: "Cognitive-friendly — short sentences, one question at a time",
  speech_difficulty: "Speech difficulty — longer pauses, no interruptions",
};

export function PersonForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  // A failure that belongs to no single field: the request never reached the
  // server, or its response could not be read. Kept separate from `errors` so
  // a network problem is not reported as if the user mistyped a name.
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);

    const payload = {
      firstName: String(form.get("firstName") ?? ""),
      phone: String(form.get("phone") ?? ""),
      preferredLanguage: String(form.get("preferredLanguage") ?? ""),
      conversationProfile: String(form.get("conversationProfile") ?? ""),
      preferredCallTime: String(form.get("preferredCallTime") ?? ""),
      interests: String(form.get("interests") ?? "")
        .split(",")
        .map((interest) => interest.trim())
        .filter(Boolean),
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
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
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
                {language}
              </option>
            ))}
          </select>
        )}
      </FormField>

      <FormField label="Conversation profile" error={errors.conversationProfile}>
        {(field) => (
          <select {...field} name="conversationProfile" defaultValue="standard" className={controlClasses}>
            {CONVERSATION_PROFILES.map((profile) => (
              <option key={profile} value={profile}>
                {PROFILE_LABELS[profile] ?? profile}
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

      <FormField
        label="Interests (comma separated)"
        error={errors.interests}
        hint="Mentioned by the Companion Agent to open the conversation naturally."
      >
        {(field) => (
          <input {...field} name="interests" placeholder="gardening, family" className={controlClasses} />
        )}
      </FormField>

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

      <p className="rounded-kc border border-line bg-sunken p-4 text-sm text-muted">
        The phone number is stored on the server only and masked wherever it is shown. An
        environment-variable override can still redirect this profile&apos;s live number if one is
        set.
      </p>

      {formError ? <Notice tone="danger">{formError}</Notice> : null}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create profile"}
      </Button>
    </form>
  );
}
