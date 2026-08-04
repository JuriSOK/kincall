// The canonical list of preset avatar identifiers — the single source of
// truth both the server-side validator (shared/validation/profile.ts) and the
// UI registry (frontend/components/avatars/registry.tsx) import, so the two can never
// silently drift apart (a key the UI can render but the validator rejects, or
// vice versa). Deliberately framework-free: this file has no React import, so
// it can be imported from either a "pure" validation module or a component.
//
// Preset avatars only — never an uploaded image or a remote URL (Stage C
// brief §4). Adding a ninth key means adding both an entry here and its
// matching graphic in the UI registry; the two are checked against each other
// by tests/avatars.test.ts.
export const AVATAR_KEYS = [
  "sunrise",
  "olive",
  "terracotta",
  "lavender",
  "ocean",
  "meadow",
  "amber",
  "rose",
] as const;

export type AvatarKey = (typeof AVATAR_KEYS)[number];

export function isAvatarKey(value: string): value is AvatarKey {
  return (AVATAR_KEYS as readonly string[]).includes(value);
}
