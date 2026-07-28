"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CONVERSATION_PROFILES,
  PREFERRED_LANGUAGES,
  validatePersonInput,
  type FieldErrors,
} from "@/lib/validation/profile";

const PROFILE_LABELS: Record<string, string> = {
  standard: "Standard — warm and open-ended",
  cognitive_friendly: "Cognitive-friendly — short sentences, one question at a time",
  speech_difficulty: "Speech difficulty — longer pauses, no interruptions",
};

export function PersonForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);

    const payload = {
      firstName: String(form.get("firstName") ?? ""),
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
    const response = await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { errors?: FieldErrors };
      setErrors(body.errors ?? { firstName: "Could not create this profile." });
      setSubmitting(false);
      return;
    }

    const { personId } = (await response.json()) as { personId: string };
    router.push(`/people/${personId}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <Field label="First name" error={errors.firstName}>
        <input
          name="firstName"
          required
          maxLength={50}
          className="w-full rounded-md border border-black/20 px-3 py-2 dark:border-white/20 dark:bg-transparent"
        />
      </Field>

      <Field label="Language" error={errors.preferredLanguage}>
        <select
          name="preferredLanguage"
          defaultValue="fr-FR"
          className="w-full rounded-md border border-black/20 px-3 py-2 dark:border-white/20 dark:bg-transparent"
        >
          {PREFERRED_LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {language}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Conversation profile" error={errors.conversationProfile}>
        <select
          name="conversationProfile"
          defaultValue="standard"
          className="w-full rounded-md border border-black/20 px-3 py-2 dark:border-white/20 dark:bg-transparent"
        >
          {CONVERSATION_PROFILES.map((profile) => (
            <option key={profile} value={profile}>
              {PROFILE_LABELS[profile] ?? profile}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Preferred check-in time" error={errors.preferredCallTime}>
        <input
          name="preferredCallTime"
          type="time"
          defaultValue="09:00"
          className="w-full rounded-md border border-black/20 px-3 py-2 dark:border-white/20 dark:bg-transparent"
        />
      </Field>

      <Field
        label="Interests (comma separated)"
        error={errors.interests}
        hint="Mentioned by the Companion Agent to open the conversation naturally."
      >
        <input
          name="interests"
          placeholder="gardening, family"
          className="w-full rounded-md border border-black/20 px-3 py-2 dark:border-white/20 dark:bg-transparent"
        />
      </Field>

      <label className="flex items-start gap-3 rounded-md border border-black/10 p-4 text-sm dark:border-white/10">
        <input name="consent" type="checkbox" className="mt-1" />
        <span>
          <span className="font-medium">They have agreed to be called.</span>
          <span className="block opacity-70">
            KinCall only calls people who have accepted automated calls, conversation analysis,
            and sharing the necessary facts with their trusted circle. Without this, the profile
            is saved but no check-in can be launched.
          </span>
        </span>
      </label>

      <p className="rounded-md border border-black/10 p-4 text-sm opacity-70 dark:border-white/10">
        Phone numbers are never stored here. A live number is configured on the server through an
        environment variable, shown on the profile once it is created.
      </p>

      <button
        type="submit"
        disabled={submitting}
        className="w-fit rounded-md border border-black/20 px-4 py-2 text-sm hover:border-black/40 disabled:opacity-50 dark:border-white/20 dark:hover:border-white/40"
      >
        {submitting ? "Creating…" : "Create profile"}
      </button>
    </form>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && !error ? <span className="text-xs opacity-60">{hint}</span> : null}
      {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : null}
    </label>
  );
}
