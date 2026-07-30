import { describe, expect, it } from "vitest";
import { AVATAR_KEYS, isAvatarKey } from "@/lib/avatars";
import { AVATAR_REGISTRY } from "@/app/ui/avatars/registry";

describe("isAvatarKey", () => {
  it("accepts every registered key", () => {
    for (const key of AVATAR_KEYS) {
      expect(isAvatarKey(key)).toBe(true);
    }
  });

  it("rejects anything not in the registry — an uploaded-photo id, garbage, empty", () => {
    expect(isAvatarKey("photo-upload-1")).toBe(false);
    expect(isAvatarKey("")).toBe(false);
    expect(isAvatarKey("Sunrise")).toBe(false); // case-sensitive: not "sunrise"
  });
});

describe("AVATAR_REGISTRY completeness", () => {
  // The single-source-of-truth guarantee DEC-015 relies on: the validator
  // (lib/avatars.ts) and the UI registry (app/ui/avatars/registry.tsx) can
  // never recognise different sets, because this test fails the moment they
  // do — whether a key is missing a graphic, or a graphic exists for a key
  // nobody can ever submit.
  it("has exactly one graphic component per AVATAR_KEYS entry, and no extras", () => {
    const registryKeys = Object.keys(AVATAR_REGISTRY).sort();
    const canonicalKeys = [...AVATAR_KEYS].sort();
    expect(registryKeys).toEqual(canonicalKeys);
  });

  it("every registered graphic is a function (a component), never undefined", () => {
    for (const key of AVATAR_KEYS) {
      expect(typeof AVATAR_REGISTRY[key]).toBe("function");
    }
  });
});
